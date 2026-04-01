import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import { OkxApiClient } from '../okx-api.client';
import type { OkxResponse, OkxTicker, OkxAccountBalance, OkxPosition, OkxOrder, OkxFundingRate } from '../interfaces/okx-types';

// ── Mock fetch ────────────────────────────────────────────────────────────────
const mockFetch = vi.fn();

describe('OkxApiClient', () => {
  const TEST_API_KEY = 'test-api-key';
  const TEST_SECRET_KEY = 'test-secret-key';
  const TEST_PASSPHRASE = 'test-passphrase';
  const TEST_BASE_URL = 'https://www.okx.com';

  let client: OkxApiClient;

  beforeEach(() => {
    vi.stubGlobal('fetch', mockFetch);
    mockFetch.mockReset();
    client = new OkxApiClient(
      TEST_API_KEY,
      TEST_SECRET_KEY,
      TEST_PASSPHRASE,
      TEST_BASE_URL,
      false,
    );
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  // ── Helper: create a mock Response ──────────────────────────────────────
  function mockResponse(body: unknown, status = 200): Response {
    return {
      ok: status >= 200 && status < 400,
      status,
      statusText: status === 200 ? 'OK' : 'Error',
      json: vi.fn().mockResolvedValue(body),
    } as unknown as Response;
  }

  // ── 1. HMAC-SHA256 signature generation ─────────────────────────────────
  describe('sign()', () => {
    it('generates correct HMAC-SHA256 signature in base64', () => {
      const timestamp = '2026-03-31T12:00:00.000Z';
      const method = 'GET';
      const requestPath = '/api/v5/account/balance';
      const body = '';

      const signature = client.sign(timestamp, method, requestPath, body);

      // The signature should be a base64-encoded string
      expect(signature).toBeTruthy();
      expect(typeof signature).toBe('string');
      // Base64 pattern
      expect(signature).toMatch(/^[A-Za-z0-9+/]+=*$/);
    });

    it('produces different signatures for different methods', () => {
      const timestamp = '2026-03-31T12:00:00.000Z';
      const path = '/api/v5/account/balance';

      const getSig = client.sign(timestamp, 'GET', path, '');
      const postSig = client.sign(timestamp, 'POST', path, '');

      expect(getSig).not.toBe(postSig);
    });

    it('produces different signatures for different paths', () => {
      const timestamp = '2026-03-31T12:00:00.000Z';

      const sig1 = client.sign(timestamp, 'GET', '/api/v5/account/balance', '');
      const sig2 = client.sign(timestamp, 'GET', '/api/v5/account/positions', '');

      expect(sig1).not.toBe(sig2);
    });

    it('includes body in signature for POST requests', () => {
      const timestamp = '2026-03-31T12:00:00.000Z';
      const path = '/api/v5/trade/order';

      const sigWithBody = client.sign(timestamp, 'POST', path, '{"instId":"BTC-USDT-SWAP"}');
      const sigWithoutBody = client.sign(timestamp, 'POST', path, '');

      expect(sigWithBody).not.toBe(sigWithoutBody);
    });

    it('converts method to uppercase for signing', () => {
      const timestamp = '2026-03-31T12:00:00.000Z';
      const path = '/api/v5/account/balance';

      const sigLower = client.sign(timestamp, 'get', path, '');
      const sigUpper = client.sign(timestamp, 'GET', path, '');

      expect(sigLower).toBe(sigUpper);
    });

    it('produces deterministic signatures for same inputs', () => {
      const timestamp = '2026-03-31T12:00:00.000Z';
      const method = 'GET';
      const path = '/api/v5/market/ticker?instId=BTC-USDT-SWAP';

      const sig1 = client.sign(timestamp, method, path, '');
      const sig2 = client.sign(timestamp, method, path, '');

      expect(sig1).toBe(sig2);
    });

    it('produces different signatures for different secret keys', () => {
      const timestamp = '2026-03-31T12:00:00.000Z';
      const path = '/api/v5/account/balance';

      const client2 = new OkxApiClient(
        TEST_API_KEY,
        'different-secret-key',
        TEST_PASSPHRASE,
        TEST_BASE_URL,
      );

      const sig1 = client.sign(timestamp, 'GET', path, '');
      const sig2 = client2.sign(timestamp, 'GET', path, '');

      expect(sig1).not.toBe(sig2);
    });
  });

  // ── 2. Auth headers ─────────────────────────────────────────────────────
  describe('auth headers', () => {
    it('includes required OKX auth headers on GET requests', async () => {
      const okxResponse: OkxResponse<OkxTicker> = {
        code: '0',
        msg: '',
        data: [{
          instId: 'BTC-USDT-SWAP',
          last: '65000',
          lastSz: '1',
          askPx: '65001',
          askSz: '10',
          bidPx: '64999',
          bidSz: '10',
          open24h: '64000',
          high24h: '66000',
          low24h: '63000',
          vol24h: '100000',
          volCcy24h: '6500000000',
          ts: '1711886400000',
        }],
      };

      mockFetch.mockResolvedValue(mockResponse(okxResponse));

      await client.getTicker('BTC-USDT-SWAP');

      expect(mockFetch).toHaveBeenCalledWith(
        `${TEST_BASE_URL}/api/v5/market/ticker?instId=BTC-USDT-SWAP`,
        expect.objectContaining({
          method: 'GET',
          headers: expect.objectContaining({
            'OK-ACCESS-KEY': TEST_API_KEY,
            'OK-ACCESS-PASSPHRASE': TEST_PASSPHRASE,
            'Content-Type': 'application/json',
          }),
        }),
      );

      // Verify OK-ACCESS-SIGN and OK-ACCESS-TIMESTAMP are present
      const headers = (mockFetch.mock.calls[0]![1] as RequestInit).headers as Record<string, string>;
      expect(headers['OK-ACCESS-SIGN']).toBeTruthy();
      expect(headers['OK-ACCESS-TIMESTAMP']).toBeTruthy();
    });

    it('includes x-simulated-trading header when sandbox is true', async () => {
      const sandboxClient = new OkxApiClient(
        TEST_API_KEY,
        TEST_SECRET_KEY,
        TEST_PASSPHRASE,
        TEST_BASE_URL,
        true,
      );

      const okxResponse: OkxResponse<OkxTicker> = {
        code: '0',
        msg: '',
        data: [],
      };

      mockFetch.mockResolvedValue(mockResponse(okxResponse));

      await sandboxClient.getTicker('BTC-USDT-SWAP');

      const headers = (mockFetch.mock.calls[0]![1] as RequestInit).headers as Record<string, string>;
      expect(headers['x-simulated-trading']).toBe('1');
    });

    it('does NOT include x-simulated-trading header when sandbox is false', async () => {
      const okxResponse: OkxResponse<OkxTicker> = {
        code: '0',
        msg: '',
        data: [],
      };

      mockFetch.mockResolvedValue(mockResponse(okxResponse));

      await client.getTicker('BTC-USDT-SWAP');

      const headers = (mockFetch.mock.calls[0]![1] as RequestInit).headers as Record<string, string>;
      expect(headers['x-simulated-trading']).toBeUndefined();
    });
  });

  // ── 3. getTicker ────────────────────────────────────────────────────────
  describe('getTicker()', () => {
    it('returns ticker data on success', async () => {
      const ticker: OkxTicker = {
        instId: 'BTC-USDT-SWAP',
        last: '65000',
        lastSz: '1',
        askPx: '65001',
        askSz: '10',
        bidPx: '64999',
        bidSz: '10',
        open24h: '64000',
        high24h: '66000',
        low24h: '63000',
        vol24h: '100000',
        volCcy24h: '6500000000',
        ts: '1711886400000',
      };

      mockFetch.mockResolvedValue(
        mockResponse({ code: '0', msg: '', data: [ticker] }),
      );

      const result = await client.getTicker('BTC-USDT-SWAP');

      expect(result).toEqual(ticker);
      expect(result?.instId).toBe('BTC-USDT-SWAP');
      expect(result?.last).toBe('65000');
    });

    it('returns null when data array is empty', async () => {
      mockFetch.mockResolvedValue(
        mockResponse({ code: '0', msg: '', data: [] }),
      );

      const result = await client.getTicker('NONEXISTENT');
      expect(result).toBeNull();
    });

    it('returns null on HTTP error', async () => {
      mockFetch.mockResolvedValue(mockResponse({}, 500));

      const result = await client.getTicker('BTC-USDT-SWAP');
      expect(result).toBeNull();
    });

    it('returns null on OKX error code', async () => {
      mockFetch.mockResolvedValue(
        mockResponse({ code: '51001', msg: 'Instrument does not exist', data: [] }),
      );

      const result = await client.getTicker('INVALID');
      expect(result).toBeNull();
    });

    it('returns null on network error', async () => {
      mockFetch.mockRejectedValue(new Error('Network error'));

      const result = await client.getTicker('BTC-USDT-SWAP');
      expect(result).toBeNull();
    });
  });

  // ── 4. getAccountBalance ────────────────────────────────────────────────
  describe('getAccountBalance()', () => {
    it('returns account balance on success', async () => {
      const balance: OkxAccountBalance = {
        totalEq: '150000.00',
        isoEq: '0',
        adjEq: '150000.00',
        ordFroz: '1000.00',
        imr: '5000.00',
        mmr: '2500.00',
        notionalUsd: '100000.00',
        details: [{
          ccy: 'USDT',
          eq: '150000.00',
          cashBal: '100000.00',
          availBal: '95000.00',
          frozenBal: '5000.00',
          upl: '500.00',
        }],
      };

      mockFetch.mockResolvedValue(
        mockResponse({ code: '0', msg: '', data: [balance] }),
      );

      const result = await client.getAccountBalance();

      expect(result).toEqual(balance);
      expect(result?.totalEq).toBe('150000.00');
      expect(result?.details[0]?.ccy).toBe('USDT');
    });

    it('returns null on failure', async () => {
      mockFetch.mockResolvedValue(mockResponse({}, 401));

      const result = await client.getAccountBalance();
      expect(result).toBeNull();
    });
  });

  // ── 5. getPositions ─────────────────────────────────────────────────────
  describe('getPositions()', () => {
    it('returns position array on success', async () => {
      const positions: OkxPosition[] = [
        {
          instId: 'BTC-USDT-SWAP',
          posSide: 'long',
          pos: '10',
          avgPx: '64000',
          upl: '10000',
          uplRatio: '0.015625',
          lever: '10',
          liqPx: '58000',
          markPx: '65000',
          margin: '6400',
          mgnMode: 'cross',
          notionalUsd: '65000',
          cTime: '1711886400000',
          uTime: '1711886400000',
        },
      ];

      mockFetch.mockResolvedValue(
        mockResponse({ code: '0', msg: '', data: positions }),
      );

      const result = await client.getPositions();

      expect(result).toHaveLength(1);
      expect(result[0]!.instId).toBe('BTC-USDT-SWAP');
      expect(result[0]!.pos).toBe('10');
    });

    it('returns empty array on failure', async () => {
      mockFetch.mockResolvedValue(mockResponse({}, 500));

      const result = await client.getPositions();
      expect(result).toEqual([]);
    });
  });

  // ── 6. placeOrder ──────────────────────────────────────────────────────
  describe('placeOrder()', () => {
    it('sends POST with correct body and returns order', async () => {
      const order: OkxOrder = {
        instId: 'BTC-USDT-SWAP',
        ordId: '12345',
        clOrdId: '',
        side: 'buy',
        ordType: 'market',
        sz: '1',
        px: '',
        state: 'filled',
        fillPx: '65000',
        fillSz: '1',
        avgPx: '65000',
        fee: '-3.25',
        feeCcy: 'USDT',
        pnl: '0',
        cTime: '1711886400000',
        uTime: '1711886400000',
      };

      mockFetch.mockResolvedValue(
        mockResponse({ code: '0', msg: '', data: [order] }),
      );

      const result = await client.placeOrder({
        instId: 'BTC-USDT-SWAP',
        tdMode: 'cross',
        side: 'buy',
        ordType: 'market',
        sz: '1',
      });

      expect(result).toEqual(order);
      expect(result?.ordId).toBe('12345');

      // Verify POST body
      const callArgs = mockFetch.mock.calls[0]![1] as RequestInit;
      const parsedBody = JSON.parse(callArgs.body as string);
      expect(parsedBody).toEqual({
        instId: 'BTC-USDT-SWAP',
        tdMode: 'cross',
        side: 'buy',
        ordType: 'market',
        sz: '1',
      });
    });

    it('includes price for limit orders', async () => {
      mockFetch.mockResolvedValue(
        mockResponse({ code: '0', msg: '', data: [{ ordId: '456' }] }),
      );

      await client.placeOrder({
        instId: 'BTC-USDT-SWAP',
        tdMode: 'cross',
        side: 'buy',
        ordType: 'limit',
        sz: '1',
        px: '64000',
      });

      const callArgs = mockFetch.mock.calls[0]![1] as RequestInit;
      const parsedBody = JSON.parse(callArgs.body as string);
      expect(parsedBody.px).toBe('64000');
    });

    it('includes reduceOnly when set', async () => {
      mockFetch.mockResolvedValue(
        mockResponse({ code: '0', msg: '', data: [{ ordId: '789' }] }),
      );

      await client.placeOrder({
        instId: 'BTC-USDT-SWAP',
        tdMode: 'cross',
        side: 'sell',
        ordType: 'market',
        sz: '1',
        reduceOnly: true,
      });

      const callArgs = mockFetch.mock.calls[0]![1] as RequestInit;
      const parsedBody = JSON.parse(callArgs.body as string);
      expect(parsedBody.reduceOnly).toBe(true);
    });

    it('returns null on failure', async () => {
      mockFetch.mockResolvedValue(mockResponse({}, 400));

      const result = await client.placeOrder({
        instId: 'BTC-USDT-SWAP',
        tdMode: 'cross',
        side: 'buy',
        ordType: 'market',
        sz: '1',
      });

      expect(result).toBeNull();
    });
  });

  // ── 7. cancelOrder ─────────────────────────────────────────────────────
  describe('cancelOrder()', () => {
    it('returns true on success', async () => {
      mockFetch.mockResolvedValue(
        mockResponse({ code: '0', msg: '', data: [{ ordId: '12345' }] }),
      );

      const result = await client.cancelOrder('BTC-USDT-SWAP', '12345');

      expect(result).toBe(true);

      // Verify POST body
      const callArgs = mockFetch.mock.calls[0]![1] as RequestInit;
      const parsedBody = JSON.parse(callArgs.body as string);
      expect(parsedBody).toEqual({
        instId: 'BTC-USDT-SWAP',
        ordId: '12345',
      });
    });

    it('returns false on failure', async () => {
      mockFetch.mockResolvedValue(mockResponse({}, 400));

      const result = await client.cancelOrder('BTC-USDT-SWAP', '99999');
      expect(result).toBe(false);
    });
  });

  // ── 8. getFundingRate ──────────────────────────────────────────────────
  describe('getFundingRate()', () => {
    it('returns funding rate on success', async () => {
      const fundingRate: OkxFundingRate = {
        instId: 'BTC-USDT-SWAP',
        fundingRate: '0.0001',
        nextFundingRate: '0.00015',
        fundingTime: '1711900800000',
      };

      mockFetch.mockResolvedValue(
        mockResponse({ code: '0', msg: '', data: [fundingRate] }),
      );

      const result = await client.getFundingRate('BTC-USDT-SWAP');

      expect(result).toEqual(fundingRate);
      expect(result?.fundingRate).toBe('0.0001');
    });

    it('returns null on failure', async () => {
      mockFetch.mockRejectedValue(new Error('Network error'));

      const result = await client.getFundingRate('BTC-USDT-SWAP');
      expect(result).toBeNull();
    });
  });

  // ── 9. Default base URL ────────────────────────────────────────────────
  describe('default base URL', () => {
    it('uses https://www.okx.com when no base URL is provided', async () => {
      const defaultClient = new OkxApiClient(
        TEST_API_KEY,
        TEST_SECRET_KEY,
        TEST_PASSPHRASE,
      );

      mockFetch.mockResolvedValue(
        mockResponse({ code: '0', msg: '', data: [] }),
      );

      await defaultClient.getTicker('BTC-USDT-SWAP');

      expect(mockFetch).toHaveBeenCalledWith(
        'https://www.okx.com/api/v5/market/ticker?instId=BTC-USDT-SWAP',
        expect.anything(),
      );
    });
  });
});
