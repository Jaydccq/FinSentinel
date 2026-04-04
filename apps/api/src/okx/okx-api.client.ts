import { createHmac } from 'node:crypto';
import { Logger } from '@nestjs/common';
import type {
  OkxResponse,
  OkxTicker,
  OkxPosition,
  OkxOrder,
  OkxAccountBalance,
  OkxFundingRate,
} from './interfaces/okx-types';

/**
 * OKX REST API client with HMAC-SHA256 authentication.
 *
 * Sign: base64(hmacSha256(timestamp + method + path + body, secretKey))
 * Headers: OK-ACCESS-KEY, OK-ACCESS-SIGN, OK-ACCESS-TIMESTAMP, OK-ACCESS-PASSPHRASE
 * Optionally: x-simulated-trading: 1 for sandbox mode
 *
 * NOT an Injectable -- instantiated by OkxModule at runtime,
 * matching the pattern used by AlpacaTradingEngine.
 */
export class OkxApiClient {
  private static readonly DEFAULT_BASE_URL = 'https://www.okx.com';
  private readonly logger = new Logger(OkxApiClient.name);
  private readonly baseUrl: string;

  constructor(
    private readonly apiKey: string,
    private readonly secretKey: string,
    private readonly passphrase: string,
    baseUrl?: string,
    private readonly sandbox: boolean = false,
  ) {
    this.baseUrl = baseUrl ?? OkxApiClient.DEFAULT_BASE_URL;
  }

  // ---------------------------------------------------------------------------
  // Public API methods
  // ---------------------------------------------------------------------------

  /** GET /api/v5/market/ticker — fetch ticker for an instrument */
  async getTicker(instId: string): Promise<OkxTicker | null> {
    try {
      const response = await this.sendGet(
        `/api/v5/market/ticker?instId=${encodeURIComponent(instId)}`,
      );
      const body = (await response.json()) as OkxResponse<OkxTicker>;
      this.checkOkxResponse(body);
      return body.data[0] ?? null;
    } catch (err) {
      this.logger.error(`Failed to get ticker for ${instId}`, err);
      return null;
    }
  }

  /** GET /api/v5/account/balance — fetch account balance */
  async getAccountBalance(): Promise<OkxAccountBalance | null> {
    try {
      const response = await this.sendGet('/api/v5/account/balance');
      const body = (await response.json()) as OkxResponse<OkxAccountBalance>;
      this.checkOkxResponse(body);
      return body.data[0] ?? null;
    } catch (err) {
      this.logger.error('Failed to get account balance', err);
      return null;
    }
  }

  /** GET /api/v5/account/positions — fetch all positions */
  async getPositions(): Promise<OkxPosition[]> {
    try {
      const response = await this.sendGet('/api/v5/account/positions');
      const body = (await response.json()) as OkxResponse<OkxPosition>;
      this.checkOkxResponse(body);
      return body.data;
    } catch (err) {
      this.logger.error('Failed to get positions', err);
      return [];
    }
  }

  /** POST /api/v5/trade/order — place an order */
  async placeOrder(params: {
    instId: string;
    tdMode: string;         // "cross", "isolated", "cash"
    side: string;           // "buy" or "sell"
    ordType: string;        // "market", "limit"
    sz: string;             // size
    px?: string;            // price (for limit orders)
    reduceOnly?: boolean;
  }): Promise<OkxOrder | null> {
    try {
      const requestBody: Record<string, unknown> = {
        instId: params.instId,
        tdMode: params.tdMode,
        side: params.side,
        ordType: params.ordType,
        sz: params.sz,
      };

      if (params.px != null) {
        requestBody['px'] = params.px;
      }
      if (params.reduceOnly) {
        requestBody['reduceOnly'] = true;
      }

      const response = await this.sendPost('/api/v5/trade/order', requestBody);
      const body = (await response.json()) as OkxResponse<OkxOrder>;
      this.checkOkxResponse(body);
      return body.data[0] ?? null;
    } catch (err) {
      this.logger.error('Failed to place order', err);
      return null;
    }
  }

  /** GET /api/v5/trade/orders-pending — fetch all pending orders */
  async getPendingOrders(): Promise<OkxOrder[]> {
    try {
      const response = await this.sendGet('/api/v5/trade/orders-pending');
      const body = (await response.json()) as OkxResponse<OkxOrder>;
      this.checkOkxResponse(body);
      return body.data;
    } catch (err) {
      this.logger.error('Failed to get pending orders', err);
      return [];
    }
  }

  /** GET /api/v5/trade/orders-history — fetch historical orders */
  async getOrderHistory(instType?: string): Promise<OkxOrder[]> {
    try {
      let path = '/api/v5/trade/orders-history';
      if (instType) {
        path += `?instType=${encodeURIComponent(instType)}`;
      }
      const response = await this.sendGet(path);
      const body = (await response.json()) as OkxResponse<OkxOrder>;
      this.checkOkxResponse(body);
      return body.data;
    } catch (err) {
      this.logger.error('Failed to get order history', err);
      return [];
    }
  }

  /** POST /api/v5/trade/cancel-order — cancel an order */
  async cancelOrder(instId: string, ordId: string): Promise<boolean> {
    try {
      const response = await this.sendPost('/api/v5/trade/cancel-order', {
        instId,
        ordId,
      });
      const body = (await response.json()) as OkxResponse<unknown>;
      this.checkOkxResponse(body);
      return true;
    } catch (err) {
      this.logger.error(`Failed to cancel order ${ordId}`, err);
      return false;
    }
  }

  /** GET /api/v5/public/funding-rate — fetch funding rate for an instrument */
  async getFundingRate(instId: string): Promise<OkxFundingRate | null> {
    try {
      const response = await this.sendGet(
        `/api/v5/public/funding-rate?instId=${encodeURIComponent(instId)}`,
      );
      const body = (await response.json()) as OkxResponse<OkxFundingRate>;
      this.checkOkxResponse(body);
      return body.data[0] ?? null;
    } catch (err) {
      this.logger.error(`Failed to get funding rate for ${instId}`, err);
      return null;
    }
  }

  /** POST /api/v5/account/set-leverage — configure leverage for an instrument */
  async setLeverage(
    instId: string,
    leverage: string,
    marginMode: string,
  ): Promise<boolean> {
    try {
      const response = await this.sendPost('/api/v5/account/set-leverage', {
        instId,
        lever: leverage,
        mgnMode: marginMode,
      });
      const body = (await response.json()) as OkxResponse<unknown>;
      this.checkOkxResponse(body);
      return true;
    } catch (err) {
      this.logger.error(`Failed to set leverage for ${instId}`, err);
      return false;
    }
  }

  // ---------------------------------------------------------------------------
  // HMAC-SHA256 signature generation
  // ---------------------------------------------------------------------------

  /**
   * Generates the OKX API signature.
   * Sign = base64(hmacSha256(timestamp + method + requestPath + body, secretKey))
   */
  sign(
    timestamp: string,
    method: string,
    requestPath: string,
    body: string,
  ): string {
    const preSign = timestamp + method.toUpperCase() + requestPath + body;
    return createHmac('sha256', this.secretKey)
      .update(preSign)
      .digest('base64');
  }

  // ---------------------------------------------------------------------------
  // HTTP helpers
  // ---------------------------------------------------------------------------

  private authHeaders(
    method: string,
    requestPath: string,
    body: string,
  ): Record<string, string> {
    const timestamp = new Date().toISOString();
    const signature = this.sign(timestamp, method, requestPath, body);

    const headers: Record<string, string> = {
      'OK-ACCESS-KEY': this.apiKey,
      'OK-ACCESS-SIGN': signature,
      'OK-ACCESS-TIMESTAMP': timestamp,
      'OK-ACCESS-PASSPHRASE': this.passphrase,
      'Content-Type': 'application/json',
    };

    if (this.sandbox) {
      headers['x-simulated-trading'] = '1';
    }

    return headers;
  }

  private async sendGet(path: string): Promise<Response> {
    const headers = this.authHeaders('GET', path, '');
    const response = await fetch(`${this.baseUrl}${path}`, {
      method: 'GET',
      headers,
    });
    this.checkHttpStatus(response);
    return response;
  }

  private async sendPost(
    path: string,
    body: Record<string, unknown>,
  ): Promise<Response> {
    const bodyStr = JSON.stringify(body);
    const headers = this.authHeaders('POST', path, bodyStr);
    const response = await fetch(`${this.baseUrl}${path}`, {
      method: 'POST',
      headers,
      body: bodyStr,
    });
    this.checkHttpStatus(response);
    return response;
  }

  private checkHttpStatus(response: Response): void {
    if (!response.ok) {
      throw new Error(
        `OKX API HTTP error ${response.status}: ${response.statusText}`,
      );
    }
  }

  private checkOkxResponse(response: OkxResponse<unknown>): void {
    if (response.code !== '0') {
      throw new Error(
        `OKX API error code ${response.code}: ${response.msg}`,
      );
    }
  }
}
