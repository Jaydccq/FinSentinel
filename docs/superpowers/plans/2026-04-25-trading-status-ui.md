# Trading Status UI — Phase 1 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development. Steps use checkbox (`- [ ]`) syntax.

**Goal:** Surface order-ledger state in the web UI with a single canonical state model. Ship a status badge component and a ledger detail card that read directly from `order_ledger` rows. Users can see — and operators can identify — `pending`, `executing`, `executed`, `partially_filled`, `failed`, and `unknown_requires_operator_review` orders without poking the DB.

**Architecture:** A new `apps/web/src/components/trading/OrderStatusBadge.tsx` translates a ledger row into a badge with a stable color/copy/icon mapping. A new `OrderLedgerCard.tsx` renders the row with: status badge, filled vs ordered, broker, error reason (when present), retry / acknowledge affordance (UI only — no API call wired in this phase). A new SWR-backed hook `useOrderLedger(filter)` fetches `/api/trading/ledger`. The Trading page gets a new "Recent Orders" section that consumes the hook. State copy lives in `apps/web/src/lib/trading/order-status-copy.ts` so QA / product can review wording in one place.

**Tech Stack:** React 19, Next.js 16 client, SWR 2.x, Vitest + React Testing Library, Tailwind (existing convention).

---

## Background

Item 10c in `docs/exec-plans/2026-04-24-codebase-optimization-triage-prd.md` is blocked on UX state design. This plan resolves the blocker by **defining** the state model in the same artifact that implements its first surface. The state model is intentionally minimal — it is the union the API already returns from `order_ledger.status` (delivered by item 3 M1–M3, on `main`).

The state model:

| Status                            | Copy                  | Color    | User action affordance                       |
| --------------------------------- | --------------------- | -------- | -------------------------------------------- |
| `PENDING`                         | "Pending"             | gray     | none (auto-progresses)                        |
| `EXECUTING`                       | "Executing"           | blue     | none (broker working)                         |
| `EXECUTED`                        | "Executed"            | green    | "View fill"                                   |
| `PARTIALLY_FILLED`                | "Partially filled"    | amber    | "View fill"                                   |
| `FAILED`                          | "Failed"              | red      | "Retry" (disabled in phase 1)                 |
| `UNKNOWN_REQUIRES_OPERATOR_REVIEW`| "Unknown — review"    | red-bold | "Acknowledge" (disabled in phase 1)           |

Phase 1 ships **read-only**. Action buttons render but are `disabled` with a `title="Coming in phase 2"` tooltip. This keeps the UI honest about what the backend can support today (operator-action endpoints land with item 3 M4).

## Scope

**In:**
- Status enum mirror in shared package (or in `apps/web/src/lib/trading/`) sourced from `packages/shared/src/trading/`.
- `OrderStatusBadge` component + tests.
- `OrderLedgerCard` component + tests.
- `useOrderLedger` SWR hook + tests.
- Trading page section "Recent Orders" rendering up to 25 rows, newest first.
- Status copy module (single source of truth for words and colors).

**Out:**
- Retry / acknowledge wiring (blocked on item 3 M4 backend).
- WebSocket / push updates — phase 1 polls every 10s while focused.
- Per-order detail page.
- Charts / fill-curve visualizations.

## Assumptions

- The API exposes `GET /api/trading/ledger` returning an array of `{ id, status, broker, side, qty, filledQty, avgPrice, errorReason, updatedAt }` rows. If the endpoint name differs, subagent uses the actual exported route from `apps/api/src/trading/trading.controller.ts` and the matching shared response schema.
- Order ledger rows already carry the `status` enum values listed above (item 3 M2 landed; verify with `rg "OrderLedgerStatus" packages/shared/src`).
- `apps/web/src/views/TradingPage.tsx` (or equivalent) exists and is a client component.

## Dependencies

- Typed-codegen plan `docs/superpowers/plans/2026-04-25-typed-api-codegen.md` — uses its registry pattern for the new ledger route.
- SWR plan `docs/superpowers/plans/2026-04-25-swr-rollout.md` — uses the SWRConfig provider and hook conventions.

If those plans are not yet on `main`, the subagent must merge them first or rebase this branch on top of them.

## File Structure

```
apps/web/src/
  lib/trading/
    order-status-copy.ts                (new)
    order-status-copy.test.ts           (new)
  components/trading/
    OrderStatusBadge.tsx                (new)
    OrderStatusBadge.test.tsx           (new)
    OrderLedgerCard.tsx                 (new)
    OrderLedgerCard.test.tsx            (new)
  hooks/api/
    use-order-ledger.ts                 (new)
    __tests__/use-order-ledger.test.tsx (new)
  api/
    trading.ts                          (modify — add ledger method if missing)
    registry.ts                         (modify — add trading.ledger route)
  views/
    TradingPage.tsx                     (modify — add "Recent Orders" section)
```

---

## Task 1: Status copy module

**Files:**
- Create: `apps/web/src/lib/trading/order-status-copy.ts`
- Create: `apps/web/src/lib/trading/order-status-copy.test.ts`

- [ ] **Step 1: Write failing test**

```ts
import { describe, it, expect } from 'vitest';
import { ORDER_STATUS_COPY, orderStatusCopy } from './order-status-copy';

describe('order status copy', () => {
  it('exposes a copy entry for every known status', () => {
    const required = [
      'PENDING',
      'EXECUTING',
      'EXECUTED',
      'PARTIALLY_FILLED',
      'FAILED',
      'UNKNOWN_REQUIRES_OPERATOR_REVIEW',
    ] as const;
    for (const s of required) {
      expect(ORDER_STATUS_COPY[s]).toBeDefined();
      expect(ORDER_STATUS_COPY[s].label.length).toBeGreaterThan(0);
      expect(ORDER_STATUS_COPY[s].colorClass.length).toBeGreaterThan(0);
    }
  });
  it('falls back to a safe default for unknown values', () => {
    expect(orderStatusCopy('totally_made_up').label).toBe('Unknown');
  });
});
```

- [ ] **Step 2: Confirm failure**

- [ ] **Step 3: Implement**

```ts
export interface OrderStatusCopy {
  label: string;
  colorClass: string;
  iconHint: 'pending' | 'spin' | 'check' | 'half' | 'cross' | 'alert';
}

export const ORDER_STATUS_COPY: Record<string, OrderStatusCopy> = {
  PENDING: { label: 'Pending', colorClass: 'bg-gray-100 text-gray-700', iconHint: 'pending' },
  EXECUTING: { label: 'Executing', colorClass: 'bg-blue-100 text-blue-700', iconHint: 'spin' },
  EXECUTED: { label: 'Executed', colorClass: 'bg-green-100 text-green-700', iconHint: 'check' },
  PARTIALLY_FILLED: {
    label: 'Partially filled',
    colorClass: 'bg-amber-100 text-amber-800',
    iconHint: 'half',
  },
  FAILED: { label: 'Failed', colorClass: 'bg-red-100 text-red-700', iconHint: 'cross' },
  UNKNOWN_REQUIRES_OPERATOR_REVIEW: {
    label: 'Unknown — review',
    colorClass: 'bg-red-200 text-red-900 ring-1 ring-red-400',
    iconHint: 'alert',
  },
};

const FALLBACK: OrderStatusCopy = {
  label: 'Unknown',
  colorClass: 'bg-gray-100 text-gray-600',
  iconHint: 'alert',
};

export function orderStatusCopy(status: string): OrderStatusCopy {
  return ORDER_STATUS_COPY[status] ?? FALLBACK;
}
```

- [ ] **Step 4: Run, expect PASS.**
- [ ] **Step 5: Commit.**

```bash
git commit -m "feat(web): add order status copy module as single source of truth"
```

---

## Task 2: OrderStatusBadge

**Files:**
- Create: `apps/web/src/components/trading/OrderStatusBadge.tsx`
- Create: `apps/web/src/components/trading/OrderStatusBadge.test.tsx`

- [ ] **Step 1: Write failing test**

```tsx
import { render, screen } from '@testing-library/react';
import { OrderStatusBadge } from './OrderStatusBadge';

it('renders the executed copy and color', () => {
  render(<OrderStatusBadge status="EXECUTED" />);
  expect(screen.getByText('Executed')).toBeInTheDocument();
  expect(screen.getByRole('status')).toHaveAttribute('data-status', 'EXECUTED');
});

it('renders fallback for unknown enum members so screens never crash', () => {
  render(<OrderStatusBadge status={'BIZARRE_NEW_ENUM' as never} />);
  expect(screen.getByText('Unknown')).toBeInTheDocument();
});
```

- [ ] **Step 2: Confirm failure.**

- [ ] **Step 3: Implement**

```tsx
import { orderStatusCopy } from '../../lib/trading/order-status-copy';

export function OrderStatusBadge({ status }: { status: string }) {
  const copy = orderStatusCopy(status);
  return (
    <span
      role="status"
      data-status={status}
      className={`inline-flex items-center gap-1 rounded px-2 py-0.5 text-xs font-medium ${copy.colorClass}`}
    >
      {copy.label}
    </span>
  );
}
```

- [ ] **Step 4: Run, expect PASS.**
- [ ] **Step 5: Commit.**

```bash
git commit -m "feat(web): add OrderStatusBadge with fallback rendering"
```

---

## Task 3: useOrderLedger hook + registry route

- [ ] **Step 1:** Verify the API exposes a ledger endpoint by reading
  `apps/api/src/trading/trading.controller.ts`. If the response schema is missing
  in `@finsentinel/shared`, add it to `packages/shared/src/trading/`.

- [ ] **Step 2:** Add the route to `apps/web/src/api/registry.ts`:

```ts
trading: {
  ledger: defineRoute({
    path: '/trading/ledger',
    method: 'GET',
    requestSchema: undefined,
    responseSchema: orderLedgerListResponseSchema,
  }),
},
```

- [ ] **Step 3:** Add a `tradingApi.ledger()` call that uses `typedFetch({ ...routes.trading.ledger })`.

- [ ] **Step 4: Write failing hook test**

```tsx
it('returns ledger rows from the trading API', async () => {
  vi.spyOn(tradingApi, 'ledger').mockResolvedValueOnce([
    { id: '1', status: 'EXECUTED', broker: 'paper' } as any,
  ]);
  const { result } = renderHook(() => useOrderLedger(), { wrapper });
  await waitFor(() => expect(result.current.data).toBeDefined());
  expect(result.current.data?.[0].status).toBe('EXECUTED');
});
```

- [ ] **Step 5:** Implement `use-order-ledger.ts`:

```ts
import useSWR from 'swr';
import { tradingApi } from '../../api/trading';

const key = ['trading', 'ledger'] as const;

export function useOrderLedger() {
  return useSWR(key, () => tradingApi.ledger(), { refreshInterval: 10_000 });
}

useOrderLedger.key = key;
```

- [ ] **Step 6: Run, expect PASS.**
- [ ] **Step 7: Commit.**

```bash
git commit -m "feat(web): add useOrderLedger hook and trading.ledger route binding"
```

---

## Task 4: OrderLedgerCard

**Files:**
- Create: `apps/web/src/components/trading/OrderLedgerCard.tsx`
- Create: `apps/web/src/components/trading/OrderLedgerCard.test.tsx`

- [ ] **Step 1: Test contract**

```tsx
const row = {
  id: 'lg-1',
  status: 'PARTIALLY_FILLED',
  broker: 'paper',
  side: 'BUY',
  qty: '100',
  filledQty: '40',
  avgPrice: '15.20',
  errorReason: null,
  updatedAt: '2026-04-25T12:00:00Z',
};

it('renders broker, side, fill ratio, and badge', () => {
  render(<OrderLedgerCard row={row as any} />);
  expect(screen.getByText('paper')).toBeInTheDocument();
  expect(screen.getByText('BUY')).toBeInTheDocument();
  expect(screen.getByText(/40 \/ 100/)).toBeInTheDocument();
  expect(screen.getByRole('status')).toHaveAttribute('data-status', 'PARTIALLY_FILLED');
});

it('shows error reason when present', () => {
  render(<OrderLedgerCard row={{ ...row, status: 'FAILED', errorReason: 'broker rejected' }} />);
  expect(screen.getByText(/broker rejected/i)).toBeInTheDocument();
});

it('renders disabled action for UNKNOWN_REQUIRES_OPERATOR_REVIEW with phase-2 tooltip', () => {
  render(
    <OrderLedgerCard row={{ ...row, status: 'UNKNOWN_REQUIRES_OPERATOR_REVIEW' }} />,
  );
  const btn = screen.getByRole('button', { name: /acknowledge/i });
  expect(btn).toBeDisabled();
  expect(btn).toHaveAttribute('title', expect.stringMatching(/phase 2/i));
});
```

- [ ] **Step 2: Confirm failure.**

- [ ] **Step 3: Implement.** Subagent writes the component using the badge + a small grid layout. Action button mapping:
  - `FAILED` → `<button disabled title="Coming in phase 2">Retry</button>`
  - `UNKNOWN_REQUIRES_OPERATOR_REVIEW` → `<button disabled title="Coming in phase 2">Acknowledge</button>`
  - others → no action button

- [ ] **Step 4: Run, expect PASS.**
- [ ] **Step 5: Commit.**

```bash
git commit -m "feat(web): add OrderLedgerCard with status-aware action affordances"
```

---

## Task 5: Recent Orders section on Trading page

- [ ] **Step 1:** Add a render test against the Trading page mocking the hook to return three rows of varying statuses; assert all three render.

- [ ] **Step 2:** Add a `<RecentOrdersSection />` to `TradingPage.tsx` that calls `useOrderLedger()` and maps rows to `<OrderLedgerCard />`. Include empty-state copy ("No orders yet") and loading skeleton (3 placeholder rows).

- [ ] **Step 3:** Run page test, expect PASS.

- [ ] **Step 4: Commit.**

```bash
git commit -m "feat(web): add Recent Orders section to Trading page"
```

---

## Task 6: Verification

- [ ] **Step 1:** `pnpm --filter @finsentinel/web typecheck` — PASS.
- [ ] **Step 2:** `pnpm --filter @finsentinel/web test` — PASS.
- [ ] **Step 3:** Update tech-debt tracker: trading-status UI phase 1 landed; retry / acknowledge wiring still depends on item 3 M4; SWR/typed-codegen rollout to remaining pages still tracked.
- [ ] **Step 4:** Push branch + open PR.

```bash
git push -u origin feat/2026-04-25-trading-status-ui-phase1
gh pr create --title "feat(web): trading status UI phase 1 — read-only ledger surface" \
  --body "Implements docs/superpowers/plans/2026-04-25-trading-status-ui.md. Ships state model, badge, ledger card, hook, Recent Orders section. Operator actions disabled in this phase pending item 3 M4."
```

## Verification Approach

1. Component tests pin every declared status to its rendered copy.
2. The page-level test proves the section integrates with the hook.
3. `data-status` attribute on the badge gives QA a stable selector.
4. Typecheck stays green; full test suite stays green.

## Risks

- **Status enum drift.** If the backend introduces a new enum value, `orderStatusCopy` falls back gracefully but the card's action mapping does not. Subagent must ensure the action button's switch statement defaults to "no button" for unknown values.
- **i18n.** Copy is English-only. Mark with a `// TODO i18n` comment at the top of the copy module so a future i18n pass can find it.
- **Color contrast.** Color classes use Tailwind defaults; designer review may want to tweak. Deferred — note in PR.

## Progress Log

(Subagent fills in.)

## Final Outcome

(Filled after merge.)
