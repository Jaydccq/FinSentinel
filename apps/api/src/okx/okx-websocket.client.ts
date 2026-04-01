import { Logger } from '@nestjs/common';
import { createHmac } from 'crypto';
import type { OkxTicker } from './interfaces/okx-types';

/**
 * Minimal WebSocket interface — allows testing without real `ws` dependency.
 * At runtime, use Node.js `WebSocket` or the `ws` library.
 */
export interface WsLike {
  onopen: (() => void) | null;
  onmessage: ((ev: { data: string }) => void) | null;
  onclose: ((ev: { code: number; reason: string }) => void) | null;
  onerror: ((ev: unknown) => void) | null;
  send(data: string): void;
  close(): void;
  readyState: number;
}

export type WsFactory = (url: string) => WsLike;

/**
 * OKX WebSocket client with dual channels (public + private) and auto-reconnect.
 *
 * Mirrors Java OkxWebSocketClient:
 * - Public channel: real-time ticker feeds (no auth)
 * - Private channel: positions, orders, account updates (HMAC auth)
 * - Auto-reconnect with exponential backoff (1s, 2s, 4s, 8s, max 30s)
 * - In-memory ticker cache updated on every tick
 *
 * NOT an Injectable — instantiated by OkxModule when enabled.
 */
export class OkxWebSocketClient {
  private readonly logger = new Logger(OkxWebSocketClient.name);

  private publicWs: WsLike | null = null;
  private privateWs: WsLike | null = null;
  private reconnectAttempts = 0;
  private readonly maxReconnectDelay = 30_000;
  private destroyed = false;

  private readonly onTickerUpdate: (instId: string, ticker: OkxTicker) => void;

  constructor(
    private readonly wsUrl: string,
    private readonly apiKey: string,
    private readonly secretKey: string,
    private readonly passphrase: string,
    private readonly watchPairs: string[],
    onTickerUpdate: (instId: string, ticker: OkxTicker) => void,
    private readonly wsFactory?: WsFactory,
  ) {
    this.onTickerUpdate = onTickerUpdate;
  }

  // ── Lifecycle ──────────────────────────────────────────────────────────────

  /**
   * Connect to both public and private WebSocket channels.
   */
  connect(): void {
    this.destroyed = false;
    this.connectPublic();
    this.connectPrivate();
  }

  /**
   * Gracefully close all connections.
   */
  disconnect(): void {
    this.destroyed = true;
    if (this.publicWs) {
      this.publicWs.close();
      this.publicWs = null;
    }
    if (this.privateWs) {
      this.privateWs.close();
      this.privateWs = null;
    }
  }

  // ── Public channel (ticker feeds) ──────────────────────────────────────────

  private connectPublic(): void {
    const url = `${this.wsUrl}/public`;
    const ws = this.createWs(url);

    ws.onopen = () => {
      this.logger.log('Public WebSocket connected');
      this.reconnectAttempts = 0;
      this.subscribeTickers(ws);
    };

    ws.onmessage = (ev) => {
      try {
        const msg = JSON.parse(ev.data) as Record<string, unknown>;
        if (msg.event === 'error') {
          this.logger.error(`Public WS error: ${JSON.stringify(msg)}`);
          return;
        }
        // Ticker data push
        if (msg.arg && Array.isArray(msg.data)) {
          for (const item of msg.data as OkxTicker[]) {
            if (item.instId) {
              this.onTickerUpdate(item.instId, item);
            }
          }
        }
      } catch {
        // Ignore pong or malformed messages
      }
    };

    ws.onclose = (ev) => {
      this.logger.warn(`Public WS closed: code=${ev.code} reason=${ev.reason}`);
      this.publicWs = null;
      if (!this.destroyed) this.scheduleReconnect('public');
    };

    ws.onerror = (err) => {
      this.logger.error(`Public WS error: ${String(err)}`);
    };

    this.publicWs = ws;
  }

  private subscribeTickers(ws: WsLike): void {
    const args = this.watchPairs.map((instId) => ({
      channel: 'tickers',
      instId,
    }));
    ws.send(JSON.stringify({ op: 'subscribe', args }));
    this.logger.log(`Subscribed to ${this.watchPairs.length} ticker channels`);
  }

  // ── Private channel (account updates) ──────────────────────────────────────

  private connectPrivate(): void {
    const url = `${this.wsUrl}/private`;
    const ws = this.createWs(url);

    ws.onopen = () => {
      this.logger.log('Private WebSocket connected');
      this.authenticate(ws);
    };

    ws.onmessage = (ev) => {
      try {
        const msg = JSON.parse(ev.data) as Record<string, unknown>;
        if (msg.event === 'login' && msg.code === '0') {
          this.logger.log('Private WS authenticated');
          this.subscribePrivateChannels(ws);
        } else if (msg.event === 'error') {
          this.logger.error(`Private WS error: ${JSON.stringify(msg)}`);
        }
        // Private data pushes (positions, orders, account) can be handled here
      } catch {
        // Ignore
      }
    };

    ws.onclose = (ev) => {
      this.logger.warn(`Private WS closed: code=${ev.code} reason=${ev.reason}`);
      this.privateWs = null;
      if (!this.destroyed) this.scheduleReconnect('private');
    };

    ws.onerror = (err) => {
      this.logger.error(`Private WS error: ${String(err)}`);
    };

    this.privateWs = ws;
  }

  private authenticate(ws: WsLike): void {
    const timestamp = String(Math.floor(Date.now() / 1000));
    const sign = this.signMessage(timestamp, 'GET', '/users/self/verify', '');

    ws.send(
      JSON.stringify({
        op: 'login',
        args: [
          {
            apiKey: this.apiKey,
            passphrase: this.passphrase,
            timestamp,
            sign,
          },
        ],
      }),
    );
  }

  private subscribePrivateChannels(ws: WsLike): void {
    ws.send(
      JSON.stringify({
        op: 'subscribe',
        args: [
          { channel: 'account' },
          { channel: 'positions', instType: 'ANY' },
          { channel: 'orders', instType: 'ANY' },
        ],
      }),
    );
    this.logger.log('Subscribed to private channels (account, positions, orders)');
  }

  // ── HMAC signing ───────────────────────────────────────────────────────────

  signMessage(
    timestamp: string,
    method: string,
    path: string,
    body: string,
  ): string {
    const prehash = timestamp + method + path + body;
    return createHmac('sha256', this.secretKey)
      .update(prehash)
      .digest('base64');
  }

  // ── Reconnect with exponential backoff ─────────────────────────────────────

  private scheduleReconnect(channel: 'public' | 'private'): void {
    const delay = Math.min(
      1000 * Math.pow(2, this.reconnectAttempts),
      this.maxReconnectDelay,
    );
    this.reconnectAttempts++;
    this.logger.log(
      `Reconnecting ${channel} channel in ${delay}ms (attempt ${this.reconnectAttempts})`,
    );

    setTimeout(() => {
      if (this.destroyed) return;
      if (channel === 'public') this.connectPublic();
      else this.connectPrivate();
    }, delay);
  }

  // ── WebSocket factory ──────────────────────────────────────────────────────

  private createWs(url: string): WsLike {
    if (this.wsFactory) {
      return this.wsFactory(url);
    }
    // Default: use global WebSocket (Node.js 21+ or ws polyfill)
    return new WebSocket(url) as unknown as WsLike;
  }

  // ── State inspection ───────────────────────────────────────────────────────

  get isPublicConnected(): boolean {
    return this.publicWs?.readyState === 1;
  }

  get isPrivateConnected(): boolean {
    return this.privateWs?.readyState === 1;
  }
}
