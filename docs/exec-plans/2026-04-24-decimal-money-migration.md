# PRD: Decimal-money migration (item 4)

Date: 2026-04-24
Status: Draft — awaiting review
Priority: P1 (unblocks live-trading guards P2)
Library choice (decided): **decimal.js**

## 1. Problem

Shared trading schema `packages/shared/src/schemas/order-draft.ts` treats `qty`, `amount`, `price` as strings but only validates length. Internally `PaperTradingEngine` (`apps/api/src/trading/brokers/paper-broker.ts`) calls `Number()` on them and does cash/position/avg-price math in JS `number`. Consequences:

- A client sending `qty: "0.1"` followed by `"0.2"` will book a filled avg-price that drifts by IEEE-754 error after enough orders.
- `qty: "-5"` and `qty: "NaN"` are not structurally rejected — only caught later by ad-hoc checks.
- `qty` and `amount` can both be set — the engine silently picks one.
- Broker adapters (Alpaca, CCXT) return strings which we stringify → `Number()` → string again; round-tripping loses precision.

## 2. Goal

1. Structural schema rejects non-decimal, non-positive, and mutually-exclusive (qty XOR amount XOR percentNav) order drafts at the boundary.
2. All server-side trading arithmetic runs through `decimal.js` `Decimal` instances, never JS `number` except for display formatting.
3. Broker adapters return decimal strings; the unified service never converts to `number`.
4. Wallet persistence keeps string columns but with a documented decimal format.

## 3. Library choice: decimal.js (final)

Rationale:
- Arbitrary precision, explicit rounding modes, well-adopted in finance (ccxt internally uses it), 67 kB min.
- `big.js` is smaller but less expressive (no trig, weaker rounding config) and we may later need ratio math for P&L / risk metrics.
- Integer minor-units were considered for speed but would require every schema + broker adapter to declare a decimals scale per symbol (equities = 2 cents; crypto varies; FX varies), which is fragile.

Alternatives kept as escape hatches:
- Display layer (frontend charts) can still use `number` for plotting — this is explicitly OK, covered by §4.5.

## 4. Scope

### 4.1 `packages/shared/src/schemas/order-draft.ts`

```ts
const decimalString = z
  .string()
  .regex(/^\d+(\.\d{1,8})?$/, 'must be a non-negative decimal with ≤ 8 fraction digits')
  .refine((s) => !/^0+(\.0+)?$/.test(s), 'must be > 0');

export const orderDraftSchema = z
  .object({
    symbol: z.string().min(1),
    side: z.enum(['buy', 'sell']),
    qty: decimalString.optional(),
    amount: decimalString.optional(),  // notional
    percentNav: decimalString.optional(),
    price: decimalString.optional(),
    // ... existing fields
  })
  .refine(
    (o) => [o.qty, o.amount, o.percentNav].filter(Boolean).length === 1,
    { message: 'exactly one of qty / amount / percentNav must be set' },
  );
```

### 4.2 `packages/shared/src/money.ts` (new)

Thin re-export of `decimal.js` pinned to an explicit precision + rounding mode, so all consumers share the same configured `Decimal`.

```ts
import DecimalJs from 'decimal.js';
export const Decimal = DecimalJs.clone({ precision: 40, rounding: DecimalJs.ROUND_HALF_EVEN });
export type DecimalValue = InstanceType<typeof Decimal>;
```

### 4.3 `apps/api/src/trading/brokers/paper-broker.ts`

- Replace all `Number(...)` calls with `new Decimal(...)`.
- `cashBalance`, `position.shares`, `avgCost`, `currentPrice` internally held as `Decimal`.
- Position updates: `newAvg = (oldShares*oldAvg + fillQty*fillPrice) / (oldShares + fillQty)` using `Decimal` ops.
- On persist, serialize as `.toFixed(8)` to the DB string column.

### 4.4 `apps/api/src/trading/unified-trading.service.ts`

- Stop using `Number(wallet.cashBalance)`; keep strings and wrap in `Decimal` at arithmetic sites.
- Commit JSON payloads stay strings end-to-end.

### 4.5 Frontend (`apps/web/src/...`)

- No change to display code; `Number()` for charts remains acceptable.
- Form inputs for trading adopt the shared `decimalString` schema so the backend and frontend can't disagree on validity.

### 4.6 Broker adapters

- Alpaca, CCXT adapters: wrap broker responses to emit decimal strings unchanged.
- No math in the adapter layer.

## 5. Migration plan (staged)

This is **4 PRs**, not one — each independently reviewable:

| PR | Files | Test surface |
|---|---|---|
| M1 | `packages/shared/src/schemas/order-draft.ts` + new `money.ts` + shared schema tests | Add ≥ 15 schema cases (decimal regex, mutual exclusion, edge NaN/Inf/negative/zero/empty) |
| M2 | `paper-broker.ts` internal arithmetic ported to `Decimal`; unit tests updated to assert no floating drift over 100 sequential fills | Paper broker test suite + a new drift-regression test |
| M3 | `unified-trading.service.ts` + wallet persistence (serialize `.toFixed(8)`); integration tests | Trading integration suite |
| M4 | Alpaca + CCXT adapter wrappers; frontend form schema import | Broker-specific tests |

Total effort: ~1 engineer-week. Do **not** land as a single PR.

## 6. Risk

- **Wallet data already in DB**: existing rows are `number`-serialized strings (e.g. `"100.00000000000001"`). M3 must normalize on read: parse via `new Decimal(s).toFixed(8)` before use. Write a one-shot migration script or let it fix itself on next wallet update. Document in runbook.
- **Broker adapter drift**: CCXT sometimes returns scientific notation (`1e-8`). Regex must reject these — adapter must pre-normalize.
- **Performance**: `decimal.js` is ~10x slower than `Number` for arithmetic. Paper broker commits ≤ 100 ops → negligible. Not a concern.

## 7. Out of scope

- Risk engine (VaR, beta) stays on `number`. That math is approximate anyway.
- Charts, frontends, metrics: `number` OK.
- Database column type changes: strings today, strings tomorrow.

## 8. Acceptance

- All decimal regex, mutual-exclusion, NaN/Inf/negative/zero tests pass.
- A property-based test: 10k sequential fills with random decimal qtys and prices produces byte-identical `toFixed(8)` across two runs.
- Alpaca and CCXT adapter tests return decimal strings unchanged.
- No new `Number(` call in `apps/api/src/trading/` (enforced by a grep-based CI check).

## 9. Owner

TBD — reviewer triage PRD leaves this to wave 1 P1 per §3.

## 10. Progress log

### 2026-04-24 — M1 shared decimal schema (DONE, commit `2d100ea`, merged via `76fc088`)

Shipped:
- `packages/shared/src/money.ts` — `Decimal = DecimalJs.clone({ precision: 40, rounding: ROUND_HALF_EVEN })`, `DecimalValue` type, `decimalStringRegex = /^(?!0+(\.0+)?$)\d+(\.\d{1,8})?$/` (positive, ≤ 8 frac digits, no zero).
- `packages/shared/src/schemas/decimal-string.ts` — reusable `decimalString` Zod validator.
- `packages/shared/src/schemas/order-draft.ts` — added `decimalOrderDraftSchema` (sibling, not replacement) with `qty` / `amount` / `percentNav` mutual-exclusion `.refine()`. Legacy `orderDraftSchema` left untouched to avoid sweeping consumer migration; the M3+M4 work below replaces consumers gradually.
- Root barrel re-exports: `Decimal`, `DecimalValue`, `decimalStringRegex`, `decimalString`.
- `packages/shared` dep gained `decimal.js`.

Tests: 28 new cases in `packages/shared/src/__tests__/decimal-order-draft-schema.test.ts` (regex edge cases, mutual-exclusion combos, field-level validation). `pnpm --filter @finsentinel/shared test` and `typecheck` clean. `apps/api` typecheck unaffected — no shims required.

### 2026-04-24 — M2 paper broker decimal arithmetic (DONE, commit `e4f9bdd`)

Shipped:
- `apps/api/src/trading/engines/paper-trading.engine.ts` — internal `cash` / `realizedPnL` / `initialCash` stored as `DecimalValue`; new `DecimalPosition` interface for shares / avgCost / currentPrice, converted to/from public `PositionMap` (number-typed) at the `setPositions` / `getPositionMaps` boundary. All math (cost, weighted avg, proceeds, P&L, market value) via `Decimal.plus/minus/times/dividedBy/greaterThan/equals`. Quote prices wrapped via `new Decimal(quote.close)` on ingest.

Public API preserved (verified): `setCash(number)`, `getCash(): number`, `setPositions(PositionMap[])`, `getPositionMaps(): PositionMap[]`, `setRealizedPnL/getRealizedPnL`, `getInitialCash(): number`, `AccountInfo.{cashValue,totalValue,buyingPower}: number` all unchanged. UnifiedTradingService still compiles untouched — M3 picks it up.

Tests: 180/180 trading suite green (was 178; +2 new). New cases: 1000-iteration drift regression at qty=0.1 @ price=0.1 — `account.cashValue === 100000 - 10` exactly, position.qty `"100"`, avgCost `"0.1"`. Plus a deterministic-property test: 100 randomized buy/sell ops produce byte-identical `String(getCash())` across two runs. **No existing test expectations needed adjustment** — Decimal `.toString()` matches the prior `String(Number(...))` byte-for-byte.

### Deferred (M3 + M4)

- **M3** (DONE on `feat/2026-04-25-trading-state-machine-and-auth-refresh`, see entry below).
- **M4** (queued): broker adapter normalization (Alpaca / OKX / CCXT) + frontend form schema migration. Independent — can ship after M3.

### 2026-04-25 — M3 decimal-precision wallet sync (DONE on branch, NOT merged to main)

Branch: `feat/2026-04-25-trading-state-machine-and-auth-refresh`. Commit: `55ed19d` (`feat(trading): decimal-precision wallet sync behind TRADING_DECIMAL_EXECUTE_ENABLED`).

**Feature flag:** `TRADING_DECIMAL_EXECUTE_ENABLED`, default `false`. Validated in `apps/api/src/config/env.validation.ts` via `envBoolean.default(false)` (added in fix commit `e254a1e`).

Shipped:
- `engines/paper-trading.engine.ts` — new public methods `setCashFromString` / `getCashAsString` / `setPositionsFromStrings` / `getPositionMapsAsStrings` returning `.toFixed(8)` strings. New `PositionMapString` type. Number-based methods retained unchanged.
- `unified-trading.service.ts` — `tradingFlags()` helper at top; the wallet→engine sync site and the engine→wallet sync site each branch on the flag, using the string boundary when on.
- `config/trading.config.ts` — `decimalExecuteEnabled` boolean (and the sibling `stateMachineEnabled` for item 3 M2).

Tests: 60 paper-engine cases (was 57; +3 string-boundary cases — 100×qty=0.1@price=0.1 produces exact `99999.00000000` with no float drift). 89 trading unified-service + order-ledger + engine cases all green. Flag-off path tested under default config; flag-on path covered by direct boundary tests.

**Known gaps / NOT shipped (M4):**
- broker adapter (Alpaca / OKX / CCXT) decimal-string normalization
- frontend form schema migration to `decimalString`
