/**
 * OKX REST API type definitions.
 *
 * All OKX responses are wrapped in a standard envelope:
 *   { code: "0", msg: "", data: [...] }
 * where code "0" indicates success.
 *
 * These types mirror the OKX v5 API response structures.
 */

// ── Envelope ────────────────────────────────────────────────────────────────

export interface OkxResponse<T> {
  code: string;
  msg: string;
  data: T[];
}

// ── Market Data ─────────────────────────────────────────────────────────────

export interface OkxTicker {
  instId: string; // e.g. "BTC-USDT-SWAP"
  last: string; // last traded price
  lastSz: string; // last traded size
  askPx: string; // best ask price
  askSz: string; // best ask size
  bidPx: string; // best bid price
  bidSz: string; // best bid size
  open24h: string; // 24h open price
  high24h: string; // 24h high
  low24h: string; // 24h low
  vol24h: string; // 24h volume (contracts)
  volCcy24h: string; // 24h volume (currency)
  ts: string; // timestamp in ms
}

// ── Account ─────────────────────────────────────────────────────────────────

export interface OkxAccountBalance {
  totalEq: string; // total equity in USD
  isoEq: string; // isolated margin equity
  adjEq: string; // adjusted equity
  ordFroz: string; // order-frozen margin
  imr: string; // initial margin requirement
  mmr: string; // maintenance margin requirement
  notionalUsd: string; // notional value in USD
  details: OkxBalanceDetail[];
}

export interface OkxBalanceDetail {
  ccy: string; // currency, e.g. "USDT"
  eq: string; // equity
  cashBal: string; // cash balance
  availBal: string; // available balance
  frozenBal: string; // frozen balance
  upl: string; // unrealized PnL
}

// ── Positions ───────────────────────────────────────────────────────────────

export interface OkxPosition {
  instId: string; // e.g. "BTC-USDT-SWAP"
  posSide: string; // "long", "short", "net"
  pos: string; // position quantity (contracts)
  avgPx: string; // average entry price
  upl: string; // unrealized PnL
  uplRatio: string; // unrealized PnL ratio
  lever: string; // leverage
  liqPx: string; // liquidation price
  markPx: string; // mark price
  margin: string; // margin
  mgnMode: string; // margin mode: "cross" or "isolated"
  notionalUsd: string; // notional value in USD
  cTime: string; // creation time (ms)
  uTime: string; // update time (ms)
}

// ── Orders ──────────────────────────────────────────────────────────────────

export interface OkxOrder {
  instId: string; // e.g. "BTC-USDT-SWAP"
  ordId: string; // order ID
  clOrdId: string; // client order ID
  side: string; // "buy" or "sell"
  ordType: string; // "market", "limit", "post_only", etc.
  sz: string; // size (contracts)
  px: string; // price (for limit orders)
  state: string; // "live", "partially_filled", "filled", "canceled"
  fillPx: string; // fill price
  fillSz: string; // fill size
  avgPx: string; // average fill price
  fee: string; // fee
  feeCcy: string; // fee currency
  pnl: string; // profit and loss
  cTime: string; // creation time (ms)
  uTime: string; // update time (ms)
}

// ── Funding Rate ────────────────────────────────────────────────────────────

export interface OkxFundingRate {
  instId: string; // e.g. "BTC-USDT-SWAP"
  fundingRate: string; // current funding rate
  nextFundingRate: string; // predicted next funding rate
  fundingTime: string; // next settlement time (ms)
}
