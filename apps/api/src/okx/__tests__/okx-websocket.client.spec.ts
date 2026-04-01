import { describe, it, expect, beforeEach, vi } from 'vitest';
import { OkxWebSocketClient, type WsLike, type WsFactory } from '../okx-websocket.client';
import type { OkxTicker } from '../interfaces/okx-types';

function createMockWs(): WsLike & { _trigger: (event: string, data?: unknown) => void } {
  const ws: WsLike & { _trigger: (event: string, data?: unknown) => void } = {
    onopen: null,
    onmessage: null,
    onclose: null,
    onerror: null,
    send: vi.fn(),
    close: vi.fn(),
    readyState: 1,
    _trigger(event: string, data?: unknown) {
      if (event === 'open' && this.onopen) this.onopen();
      if (event === 'message' && this.onmessage) this.onmessage({ data: data as string });
      if (event === 'close' && this.onclose) this.onclose({ code: 1000, reason: 'test' });
      if (event === 'error' && this.onerror) this.onerror(data);
    },
  };
  return ws;
}

describe('OkxWebSocketClient', () => {
  let mockPublicWs: ReturnType<typeof createMockWs>;
  let mockPrivateWs: ReturnType<typeof createMockWs>;
  let tickerUpdates: Array<{ instId: string; ticker: OkxTicker }>;
  let client: OkxWebSocketClient;
  let wsFactory: WsFactory;

  beforeEach(() => {
    mockPublicWs = createMockWs();
    mockPrivateWs = createMockWs();
    tickerUpdates = [];
    let callCount = 0;

    wsFactory = vi.fn((_url: string) => {
      callCount++;
      return callCount === 1 ? mockPublicWs : mockPrivateWs;
    });

    client = new OkxWebSocketClient(
      'wss://ws.okx.com:8443/ws/v5',
      'test-api-key',
      'test-secret',
      'test-passphrase',
      ['BTC-USDT', 'ETH-USDT'],
      (instId, ticker) => tickerUpdates.push({ instId, ticker }),
      wsFactory,
    );
  });

  it('connects to public and private channels', () => {
    client.connect();

    expect(wsFactory).toHaveBeenCalledTimes(2);
    expect(wsFactory).toHaveBeenCalledWith('wss://ws.okx.com:8443/ws/v5/public');
    expect(wsFactory).toHaveBeenCalledWith('wss://ws.okx.com:8443/ws/v5/private');
  });

  it('subscribes to tickers on public channel open', () => {
    client.connect();
    mockPublicWs._trigger('open');

    expect(mockPublicWs.send).toHaveBeenCalledWith(
      expect.stringContaining('"op":"subscribe"'),
    );

    const msg = JSON.parse((mockPublicWs.send as ReturnType<typeof vi.fn>).mock.calls[0][0]);
    expect(msg.args).toHaveLength(2);
    expect(msg.args[0]).toEqual({ channel: 'tickers', instId: 'BTC-USDT' });
    expect(msg.args[1]).toEqual({ channel: 'tickers', instId: 'ETH-USDT' });
  });

  it('authenticates on private channel open', () => {
    client.connect();
    mockPrivateWs._trigger('open');

    expect(mockPrivateWs.send).toHaveBeenCalledWith(
      expect.stringContaining('"op":"login"'),
    );

    const msg = JSON.parse((mockPrivateWs.send as ReturnType<typeof vi.fn>).mock.calls[0][0]);
    expect(msg.args[0]).toHaveProperty('apiKey', 'test-api-key');
    expect(msg.args[0]).toHaveProperty('passphrase', 'test-passphrase');
    expect(msg.args[0]).toHaveProperty('sign');
    expect(msg.args[0]).toHaveProperty('timestamp');
  });

  it('subscribes to private channels after login success', () => {
    client.connect();
    mockPrivateWs._trigger('open');
    // Simulate login success
    mockPrivateWs._trigger('message', JSON.stringify({ event: 'login', code: '0' }));

    // First call = login, second call = subscribe
    expect(mockPrivateWs.send).toHaveBeenCalledTimes(2);
    const subMsg = JSON.parse((mockPrivateWs.send as ReturnType<typeof vi.fn>).mock.calls[1][0]);
    expect(subMsg.op).toBe('subscribe');
    expect(subMsg.args).toContainEqual({ channel: 'account' });
    expect(subMsg.args).toContainEqual({ channel: 'positions', instType: 'ANY' });
  });

  it('updates ticker cache on ticker data push', () => {
    client.connect();
    mockPublicWs._trigger('open');

    const tickerData: OkxTicker = {
      instId: 'BTC-USDT',
      last: '50000',
      lastSz: '0.1',
      askPx: '50001',
      askSz: '1',
      bidPx: '49999',
      bidSz: '1',
      open24h: '49000',
      high24h: '51000',
      low24h: '48000',
      vol24h: '10000',
      volCcy24h: '500000000',
      ts: '1711843200000',
    };

    mockPublicWs._trigger(
      'message',
      JSON.stringify({
        arg: { channel: 'tickers', instId: 'BTC-USDT' },
        data: [tickerData],
      }),
    );

    expect(tickerUpdates).toHaveLength(1);
    expect(tickerUpdates[0].instId).toBe('BTC-USDT');
    expect(tickerUpdates[0].ticker.last).toBe('50000');
  });

  it('generates correct HMAC signature', () => {
    const sign = client.signMessage('1711843200', 'GET', '/users/self/verify', '');
    expect(sign).toBeTruthy();
    expect(typeof sign).toBe('string');
    // Base64 encoded HMAC-SHA256 should be 44 chars
    expect(sign.length).toBe(44);
  });

  it('disconnects both channels', () => {
    client.connect();
    client.disconnect();

    expect(mockPublicWs.close).toHaveBeenCalled();
    expect(mockPrivateWs.close).toHaveBeenCalled();
  });

  it('reports connection status', () => {
    client.connect();
    expect(client.isPublicConnected).toBe(true);
    expect(client.isPrivateConnected).toBe(true);
  });
});
