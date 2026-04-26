# Order Ledger UNKNOWN Operator Surface — Execution Plan

Date: 2026-04-26
Status: Draft — ready for execution
Owner: hongxichen + Claude
Source: `docs/exec-plans/2026-04-24-trading-order-ledger-state-machine.md` M4 prereq (2); `docs/exec-plans/2026-04-24-codebase-optimization-triage-prd.md` item 3 master scorecard.

## Background

Item 3 M4 (legacy `wallet.commitHistory` removal) is gated on three prereqs:
(1) M2/M3 staging soak, (2) UNKNOWN ledger operator surface, (3) read-path
audit. (2) is the only one that's pure engineering work and unlocks (1).

Today: trading status UI phase 1 renders the
`UNKNOWN_REQUIRES_OPERATOR_REVIEW` badge on `OrderLedgerCard` with a
`disabled` Acknowledge button (`apps/web/src/components/trading/OrderLedgerCard.tsx:74`).
The reconciler in `OrderLedgerService` (line ~339) marks rows
`UNKNOWN_REQUIRES_OPERATOR_REVIEW` when broker outcome can't be resolved.
There is currently NO way for an operator to inspect or resolve such rows
without direct DB access. Until that exists, we can't run the M2/M3 soak
honestly — every UNKNOWN row that lands during soak would require manual
SQL.

## Goal

Ship the smallest possible operator surface that lets a logged-in user
list, inspect, and acknowledge their own UNKNOWN ledger rows from the web
UI. Acknowledgement is metadata-only — it does NOT change the row's
`status` enum, and it does NOT replay or roll back the broker call. The
`status` stays `UNKNOWN_REQUIRES_OPERATOR_REVIEW` so future analysis can
still find these rows; the new `acknowledged_at` is the "operator has
seen and reasoned about this" signal.

Multi-user / admin operator role is **out of scope**. Acknowledge is
scoped to the row's owner — a user can only ack rows they own. Future
phase 2 can add an admin role.

## Scope

In:
- DB migration `V25__order_ledger_acknowledgement.sql` — adds
  `acknowledged_at TIMESTAMPTZ NULL`, `acknowledged_by UUID NULL` (FK to
  users), `acknowledgement_note TEXT NULL`, plus
  `order_ledger_unknown_pending_idx` partial index on
  `(user_id, updated_at DESC) WHERE status =
  'UNKNOWN_REQUIRES_OPERATOR_REVIEW' AND acknowledged_at IS NULL`.
- Drizzle schema update in `packages/db/src/schema/order-ledger.ts`.
- Shared schemas in `packages/shared/src/schemas/order-ledger.ts`:
  - Extend `orderLedgerResponseSchema` (or equivalent — verify the actual
    name) with `acknowledgedAt: z.string().datetime().nullable()`,
    `acknowledgedBy: z.string().uuid().nullable()`,
    `acknowledgementNote: z.string().nullable()`.
  - New `acknowledgeLedgerRequestSchema = z.object({ note: z.string().min(1).max(1000) })`.
- `OrderLedgerService` extensions:
  - `findUnknownPending(userId, limit): OrderLedgerRow[]` — newest first,
    cap 50, filters `status='UNKNOWN_REQUIRES_OPERATOR_REVIEW' AND
    acknowledged_at IS NULL`.
  - `acknowledge(ledgerId, userId, note): OrderLedgerRow` — atomic
    UPDATE setting ack fields when `id=ledgerId AND user_id=userId AND
    status='UNKNOWN_REQUIRES_OPERATOR_REVIEW' AND acknowledged_at IS
    NULL`. Throws `NotFoundException` otherwise.
- AgentEvent emission for ack: aggregate `TRADE_WALLET`, new event type
  `LEDGER_UNKNOWN_ACKNOWLEDGED`. Migration `V26__agent_event_type_ledger_acknowledged.sql`
  widens the SQL CHECK constraint AND
  `packages/shared/src/enums/agent-event-type.ts` adds the entry. Per
  CLAUDE.md: SQL CHECK must mirror TS enum exactly.
- API endpoints in `apps/api/src/trading/trading.controller.ts`:
  - `GET /api/trading/ledger/unknown` — returns
    `findUnknownPending(req.userId, 50)` shaped per response schema.
  - `POST /api/trading/ledger/:id/acknowledge` — body
    `{ note: string }`, returns the updated row. JwtGuard.
- Typed-API registry: add the two new routes to
  `apps/web/src/api/registry.ts`.
- Frontend hook: `useOrderLedgerUnknown()` SWR hook (mirrors
  `useOrderLedger`).
- `OrderLedgerCard.tsx`: when the row is UNKNOWN_REQUIRES_OPERATOR_REVIEW
  AND `acknowledgedAt == null`, the Acknowledge button becomes:
  - active
  - opens a small modal capturing the note (textarea + submit)
  - on submit, calls `tradingApi.acknowledgeLedger(id, { note })`,
    refreshes the parent SWR cache via `useOrderLedger()` `mutate()` AND
    `useOrderLedgerUnknown()` `mutate()`.
- `OrderStatusBadge.tsx`: when row has `acknowledgedAt != null`, show a
  small `(ack'd)` suffix label inside the badge — visual signal that an
  operator reviewed it.
- Tests at every layer (service spec, controller spec, hook test, modal
  test).

Out:
- Multi-user / admin operator role.
- Replay or rollback functionality (the broker call is not re-tried).
- Bulk acknowledge.
- Email / Slack alerts on UNKNOWN appearance.
- A standalone Operator console page.
- Filter chip on the existing Recent Orders feed (deferred — add when
  there's enough volume to justify it).

## Key decisions

1. **Ack is metadata, not a state change.** Row status stays
   `UNKNOWN_REQUIRES_OPERATOR_REVIEW`. Adding a state like
   `UNKNOWN_ACKNOWLEDGED` would force every consumer to update its
   switch / filter logic, fragmenting the state machine. The
   `acknowledged_at IS NULL` filter on the partial index is cheaper.
2. **Owner-scoped only.** No admin role; a user can only ack their own
   rows. Real multi-tenant operator permissions are a separate plan.
3. **Note is required.** `note: z.string().min(1).max(1000)`. An empty
   ack provides no audit value. The UI textarea has a placeholder
   prompting the operator to describe what they checked.
4. **AgentEvent emitted.** Trading-adjacent operator action gets an
   audit row per CLAUDE.md "Trading operations must emit AgentEvent
   entries". The new event type lives under `TRADE_WALLET` aggregate.
5. **No optimistic UI.** Modal submit awaits the server response. After
   success, both SWR caches revalidate. No optimistic mutation —
   operator should see the actual server-confirmed row before the modal
   closes.
6. **UI fits inside `OrderLedgerCard`.** No new page. The disabled
   button just becomes active. This keeps blast radius small and reuses
   the trading UI plumbing already on main.

## File structure

```
packages/db/migrations/
  V25__order_ledger_acknowledgement.sql            (new)
  V26__agent_event_type_ledger_acknowledged.sql    (new)

packages/db/src/schema/
  order-ledger.ts                                  (modify — add 3 columns)

packages/shared/src/
  schemas/order-ledger.ts                          (modify — extend response, add request schema)
  enums/agent-event-type.ts                        (modify — add LEDGER_UNKNOWN_ACKNOWLEDGED)

apps/api/src/trading/
  order-ledger/order-ledger.service.ts             (modify — findUnknownPending, acknowledge)
  order-ledger/__tests__/order-ledger.service.spec.ts (extend)
  trading.controller.ts                            (modify — 2 new routes)
  __tests__/trading.controller.spec.ts             (extend)

apps/web/src/
  api/registry.ts                                  (modify — 2 new routes)
  api/trading.ts                                   (modify — acknowledgeLedger method)
  hooks/api/use-order-ledger-unknown.ts            (new)
  hooks/api/__tests__/use-order-ledger-unknown.test.tsx (new)
  components/trading/OrderLedgerCard.tsx           (modify — wire active button)
  components/trading/AcknowledgeUnknownModal.tsx   (new)
  components/trading/__tests__/AcknowledgeUnknownModal.test.tsx (new)
  components/trading/OrderStatusBadge.tsx          (modify — ack suffix)
  components/trading/__tests__/OrderLedgerCard.test.tsx (extend)

docs/exec-plans/
  tech-debt-tracker.md                             (modify — record M4 prereq (2) closed)
```

---

## Task 1 — Migration + Drizzle schema

### 1.1 Migration

`packages/db/migrations/V25__order_ledger_acknowledgement.sql`:

```sql
ALTER TABLE order_ledger
  ADD COLUMN IF NOT EXISTS acknowledged_at TIMESTAMPTZ NULL,
  ADD COLUMN IF NOT EXISTS acknowledged_by UUID NULL REFERENCES users(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS acknowledgement_note TEXT NULL;

CREATE INDEX IF NOT EXISTS order_ledger_unknown_pending_idx
  ON order_ledger (user_id, updated_at DESC)
  WHERE status = 'UNKNOWN_REQUIRES_OPERATOR_REVIEW' AND acknowledged_at IS NULL;
```

### 1.2 Drizzle schema

`packages/db/src/schema/order-ledger.ts` — append to columns:

```ts
acknowledgedAt: timestamp('acknowledged_at', { withTimezone: true }),
acknowledgedBy: uuid('acknowledged_by').references(() => users.id, { onDelete: 'set null' }),
acknowledgementNote: text('acknowledgement_note'),
```

### 1.3 Apply + verify

```bash
pnpm --filter @finsentinel/db db:migrate
psql "$DATABASE_URL" -c "\d order_ledger" | grep acknowledg  # must show 3 columns
psql "$DATABASE_URL" -c "\di order_ledger_unknown_pending_idx"
```

### 1.4 Commit

```bash
git commit -m "feat(db): V25 order_ledger acknowledgement columns + partial UNKNOWN index"
```

---

## Task 2 — AgentEvent type + migration

### 2.1 Enum + SQL CHECK

`packages/shared/src/enums/agent-event-type.ts` — add:

```ts
LEDGER_UNKNOWN_ACKNOWLEDGED: 'LEDGER_UNKNOWN_ACKNOWLEDGED',
```

`packages/db/migrations/V26__agent_event_type_ledger_acknowledged.sql`:

```sql
ALTER TABLE agent_events
  DROP CONSTRAINT IF EXISTS agent_events_event_type_check;

-- Reapply the CHECK with the new enum value. Subagent must read the existing
-- CHECK from the most recent prior agent_events migration and append
-- 'LEDGER_UNKNOWN_ACKNOWLEDGED' to the IN-list — do NOT shrink the list.
ALTER TABLE agent_events
  ADD CONSTRAINT agent_events_event_type_check
    CHECK (event_type IN (
      -- … all existing values … ,
      'LEDGER_UNKNOWN_ACKNOWLEDGED'
    ));
```

> Subagent must read the latest CHECK constraint state from the most
> recent prior migration that touched it (grep `agent_events_event_type_check`
> in `packages/db/migrations/`) and replicate the full IN-list. Don't
> hand-write a list from memory.

### 2.2 Apply + verify

```bash
pnpm --filter @finsentinel/db db:migrate
psql "$DATABASE_URL" -c "\d+ agent_events" | grep event_type_check  # CHECK present
```

### 2.3 Commit

```bash
git commit -m "feat(db,shared): V26 add LEDGER_UNKNOWN_ACKNOWLEDGED event type"
```

---

## Task 3 — Service layer

### 3.1 findUnknownPending

`apps/api/src/trading/order-ledger/order-ledger.service.ts`:

```ts
async findUnknownPending(userId: string, limit: number): Promise<OrderLedgerRow[]> {
  const cap = Math.max(1, Math.min(limit, 50));
  return this.db
    .select()
    .from(orderLedger)
    .where(and(
      eq(orderLedger.userId, userId),
      eq(orderLedger.status, 'UNKNOWN_REQUIRES_OPERATOR_REVIEW'),
      isNull(orderLedger.acknowledgedAt),
    ))
    .orderBy(desc(orderLedger.updatedAt))
    .limit(cap);
}
```

### 3.2 acknowledge

```ts
async acknowledge(ledgerId: string, userId: string, note: string): Promise<OrderLedgerRow> {
  const trimmed = note.trim();
  if (trimmed.length === 0) throw new BadRequestException('note must not be empty');
  if (trimmed.length > 1000) throw new BadRequestException('note exceeds 1000 chars');

  const now = new Date();
  const [updated] = await this.db
    .update(orderLedger)
    .set({
      acknowledgedAt: now,
      acknowledgedBy: userId,
      acknowledgementNote: trimmed,
      updatedAt: now,
    })
    .where(and(
      eq(orderLedger.id, ledgerId),
      eq(orderLedger.userId, userId),
      eq(orderLedger.status, 'UNKNOWN_REQUIRES_OPERATOR_REVIEW'),
      isNull(orderLedger.acknowledgedAt),
    ))
    .returning();

  if (!updated) {
    throw new NotFoundException(
      'Ledger row not found, not owned by this user, not in UNKNOWN state, or already acknowledged',
    );
  }

  // Per CLAUDE.md: trading operations emit AgentEvent. We use TRADE_WALLET
  // aggregate so the audit row sits next to other trading events.
  await this.agentEvents.append({
    userId,
    aggregateType: 'TRADE_WALLET',
    aggregateId: ledgerId,
    eventType: 'LEDGER_UNKNOWN_ACKNOWLEDGED',
    payload: { note: trimmed },
  });

  return updated;
}
```

### 3.3 Tests

Extend `__tests__/order-ledger.service.spec.ts`:
- `findUnknownPending` returns only rows matching status + acknowledged_at IS NULL + same user.
- `findUnknownPending` orders by updated_at DESC.
- `findUnknownPending` caps at 50.
- `acknowledge` happy path: updates row, emits AgentEvent.
- `acknowledge` rejects when row is not UNKNOWN.
- `acknowledge` rejects when row already acknowledged.
- `acknowledge` rejects when row belongs to a different user.
- `acknowledge` rejects when note is empty / whitespace.
- `acknowledge` rejects note > 1000 chars.

### 3.4 Commit

```bash
git commit -m "feat(trading): OrderLedgerService findUnknownPending + acknowledge"
```

---

## Task 4 — Controller + shared schemas

### 4.1 Schemas

`packages/shared/src/schemas/order-ledger.ts`:

- Extend response schema (verify the exact name — should be
  `orderLedgerResponseSchema` or `orderLedgerRowSchema`):

  ```ts
  acknowledgedAt: z.string().datetime().nullable(),
  acknowledgedBy: z.string().uuid().nullable(),
  acknowledgementNote: z.string().nullable(),
  ```

- Add request schema:

  ```ts
  export const acknowledgeLedgerRequestSchema = z.object({
    note: z.string().min(1).max(1000),
  });
  export type AcknowledgeLedgerRequest = z.infer<typeof acknowledgeLedgerRequestSchema>;
  ```

Rebuild shared: `pnpm --filter @finsentinel/shared build`.

### 4.2 Controller routes

`apps/api/src/trading/trading.controller.ts`:

```ts
@Get('ledger/unknown')
async ledgerUnknown(@CurrentUser() user: AuthUser): Promise<OrderLedgerListResponse> {
  const rows = await this.orderLedger.findUnknownPending(user.id, 50);
  return { rows: rows.map(toResponseShape) };
}

@Post('ledger/:id/acknowledge')
async ledgerAcknowledge(
  @CurrentUser() user: AuthUser,
  @Param('id') id: string,
  @Body() body: unknown,
): Promise<OrderLedgerResponse> {
  const parsed = acknowledgeLedgerRequestSchema.parse(body);
  const updated = await this.orderLedger.acknowledge(id, user.id, parsed.note);
  return toResponseShape(updated);
}
```

> Subagent must wire the actual `@CurrentUser` decorator + the existing
> response shape helper. The plan's signatures are illustrative; the
> existing `@Get('ledger')` handler is the contract reference.

### 4.3 Tests

Extend `__tests__/trading.controller.spec.ts` (or `trading.e2e.spec.ts`
if controller tests live there):
- `GET /api/trading/ledger/unknown` returns 200 with array.
- `POST /api/trading/ledger/:id/acknowledge` with valid body returns 200
  with updated row including `acknowledgedAt != null`.
- `POST .../acknowledge` with empty note returns 400.
- `POST .../acknowledge` for already-ack'd row returns 404.
- Unauthenticated requests return 401.

### 4.4 Commit

```bash
git commit -m "feat(trading): GET /ledger/unknown + POST /ledger/:id/acknowledge"
```

---

## Task 5 — Web typed registry + API client + hook

### 5.1 Registry

`apps/web/src/api/registry.ts`:

```ts
trading: {
  ledger: defineRoute({ /* existing */ }),
  ledgerUnknown: defineRoute({
    path: '/trading/ledger/unknown',
    method: 'GET',
    requestSchema: undefined,
    responseSchema: orderLedgerListResponseSchema,
  }),
  ledgerAcknowledge: defineRoute({
    path: '/trading/ledger/:id/acknowledge',
    method: 'POST',
    requestSchema: acknowledgeLedgerRequestSchema,
    responseSchema: orderLedgerResponseSchema,
  }),
},
```

### 5.2 Client

`apps/web/src/api/trading.ts`:

```ts
export const tradingLedgerApi = {
  // existing list...
  unknown: () => typedFetch({ ...routes.trading.ledgerUnknown }),
  acknowledge: (id: string, body: AcknowledgeLedgerRequest) =>
    typedFetch({
      ...routes.trading.ledgerAcknowledge,
      path: routes.trading.ledgerAcknowledge.path.replace(':id', encodeURIComponent(id)),
      body,
    }),
};
```

### 5.3 Hook

`apps/web/src/hooks/api/use-order-ledger-unknown.ts`:

```ts
import useSWR from 'swr';
import { tradingLedgerApi } from '../../api/trading';

const key = ['trading', 'ledger-unknown'] as const;

export function useOrderLedgerUnknown() {
  return useSWR(key, () => tradingLedgerApi.unknown(), { refreshInterval: 30_000 });
}

useOrderLedgerUnknown.key = key;
```

### 5.4 Test the hook

Mirror `use-order-ledger.test.tsx` with one happy-path case asserting
the data returns and one error path.

### 5.5 Commit

```bash
git commit -m "feat(web): typed routes + hook for unknown ledger ack"
```

---

## Task 6 — UI: AcknowledgeUnknownModal + wire OrderLedgerCard

### 6.1 Modal component

`apps/web/src/components/trading/AcknowledgeUnknownModal.tsx`:

```tsx
'use client';
import { useState } from 'react';

interface Props {
  ledgerId: string;
  isOpen: boolean;
  onClose: () => void;
  onConfirm: (note: string) => Promise<void>;
}

export function AcknowledgeUnknownModal({ ledgerId, isOpen, onClose, onConfirm }: Props) {
  const [note, setNote] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  if (!isOpen) return null;

  const submit = async () => {
    if (note.trim().length === 0) { setError('Note is required'); return; }
    setSubmitting(true); setError(null);
    try {
      await onConfirm(note.trim());
      setNote('');
      onClose();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Acknowledge failed');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div role="dialog" aria-labelledby="ack-title" className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
      <div className="w-[480px] max-w-[90vw] rounded bg-white p-4 shadow-lg">
        <h2 id="ack-title" className="text-sm font-semibold mb-2">
          Acknowledge Unknown Order
        </h2>
        <p className="text-xs text-gray-600 mb-3">
          Order <code>{ledgerId.slice(0, 8)}…</code> is in
          UNKNOWN_REQUIRES_OPERATOR_REVIEW state. Describe what you
          investigated. The note becomes part of the audit trail.
        </p>
        <textarea
          className="w-full border rounded p-2 text-sm"
          rows={4}
          value={note}
          onChange={(e) => setNote(e.target.value)}
          placeholder="e.g. Confirmed with broker that fill landed; updating ledger metadata only."
          maxLength={1000}
        />
        <div className="text-xs text-gray-500 mt-1">{note.length}/1000</div>
        {error ? <div className="text-red-600 text-xs mt-2">{error}</div> : null}
        <div className="flex justify-end gap-2 mt-3">
          <button type="button" className="px-3 py-1 text-sm" onClick={onClose} disabled={submitting}>Cancel</button>
          <button
            type="button"
            className="px-3 py-1 text-sm bg-blue-600 text-white rounded"
            onClick={submit}
            disabled={submitting || note.trim().length === 0}
          >
            {submitting ? 'Saving…' : 'Acknowledge'}
          </button>
        </div>
      </div>
    </div>
  );
}
```

### 6.2 Tests

`AcknowledgeUnknownModal.test.tsx`:
- Renders title + textarea.
- Disabled submit when note is empty.
- Calls `onConfirm(note)` on submit and `onClose` on success.
- Surfaces server error message.
- Tab order: textarea → cancel → acknowledge.

### 6.3 Wire OrderLedgerCard

`OrderLedgerCard.tsx`:
- When `row.status === 'UNKNOWN_REQUIRES_OPERATOR_REVIEW' && row.acknowledgedAt == null`:
  - Acknowledge button is **enabled**, no `title="Coming in phase 2"`.
  - On click, opens `<AcknowledgeUnknownModal ledgerId={row.id} … />`.
  - On confirm: `await tradingLedgerApi.acknowledge(row.id, { note })`,
    then `mutate()` both `useOrderLedger.key` and
    `useOrderLedgerUnknown.key` SWR caches.
- When `row.acknowledgedAt != null`:
  - No button. Show small text `acknowledged <human time> by <userId-short>`.

### 6.4 Status badge ack suffix

`OrderStatusBadge.tsx`:
- Add optional prop `acknowledged?: boolean`.
- When `status === 'UNKNOWN_REQUIRES_OPERATOR_REVIEW' && acknowledged`,
  render extra `(ack'd)` text inside the badge so the row reads
  "Unknown — review (ack'd)".

### 6.5 Tests

Extend `OrderLedgerCard.test.tsx`:
- UNKNOWN row + ack=null → button enabled, click opens modal.
- UNKNOWN row + ack=now → no button, ack timestamp shown, badge shows
  "(ack'd)".
- Other statuses unchanged.

### 6.6 Commit

```bash
git commit -m "feat(web): AcknowledgeUnknownModal + wire OrderLedgerCard ack action"
```

---

## Task 7 — Verification + tracker close-out

### 7.1 Full verification

```bash
pnpm --filter @finsentinel/db db:migrate    # locally apply V25 + V26
pnpm --filter @finsentinel/shared build
pnpm --filter @finsentinel/api typecheck
pnpm --filter @finsentinel/api test --run
pnpm --filter @finsentinel/web typecheck
pnpm --filter @finsentinel/web test --run
pnpm --filter @finsentinel/web lint -- src/components/trading src/hooks/api
```

All must PASS. The migration application is local — staging migration is
the operator's job and not gated by this PR.

### 7.2 Manual smoke (recorded in PR description, NOT a CI gate)

- Insert a synthetic UNKNOWN row via SQL (`UPDATE order_ledger SET status='UNKNOWN_REQUIRES_OPERATOR_REVIEW', updated_at=now() WHERE id='<some uuid>';`).
- Open Trading page → see the row with the alert badge and **enabled**
  Acknowledge button.
- Click → modal opens. Submit empty → button stays disabled. Type note,
  submit → modal closes, row re-renders with `(ack'd)` and the action
  area shows "acknowledged" timestamp.
- Verify in DB: `SELECT acknowledged_at, acknowledgement_note FROM
  order_ledger WHERE id='<uuid>';` shows the note.
- Verify in agent_events: `SELECT event_type, payload FROM agent_events
  WHERE aggregate_id='<uuid>';` includes `LEDGER_UNKNOWN_ACKNOWLEDGED`.

### 7.3 Tracker close-out

Update `docs/exec-plans/tech-debt-tracker.md`:
- M4 prereq (2) — CLOSED on commit `<merge-sha>`. Operator can now
  inspect and acknowledge UNKNOWN rows from the Trading page.
- M4 prereqs (1) and (3) remain OPEN: (1) needs staging soak with
  `TRADING_STATE_MACHINE_ENABLED=true` + `TRADING_LEDGER_RECONCILER_ENABLED=true`
  for ≥ 1 week of real broker traffic; (3) read-path audit lists every
  callsite still consulting `wallet.commitHistory` before deletion.

### 7.4 Commit + push

```bash
git commit -m "docs(tech-debt): close M4 prereq (2) UNKNOWN ledger operator surface"
git push -u origin feat/2026-04-26-order-ledger-unknown-operator-surface
```

---

## Verification approach

- DB migration applies cleanly to a fresh local DB AND to a DB that has
  V24 applied (idempotent `IF NOT EXISTS`).
- New service tests cover both happy-path and 5 negative cases.
- New controller tests cover 401 / 400 / 404 paths.
- Frontend tests cover modal + card branches.
- Manual smoke validates end-to-end (DB insert → UI ack → DB read).

## Risks

- **AgentEvent CHECK constraint widening.** If V26 isn't applied
  before code that emits the new event type runs, INSERT into
  agent_events fails. Mitigation: code changes (event type usage) ship
  in the same commit as the migration; deploy order is migration first
  per the existing playbook.
- **Concurrent ack races.** Two operators clicking ack at the same time
  on the same row. The atomic UPDATE WHERE acknowledged_at IS NULL
  guarantees only one wins; the loser sees a 404. The modal handles
  the 404 via the existing error-toast surface.
- **Note PII.** Notes are free-form text; an operator might paste
  customer-identifying info. Acceptable for v1 — operators are the
  only writers, and the data already lives in the same DB. Future
  hardening could add a regex scrub on insert.
- **No bulk ack.** If staging soak produces many UNKNOWN rows in one
  burst, single-row ack is tedious. Acceptable for v1; phase 2 can add
  bulk endpoints once we see real volume.
- **Migration applied on prod accidentally.** The migration is
  additive-only. No DROP, no data loss. Reversal: drop the 3 columns +
  the partial index. Documented in the migration header comment.

## Progress log

- 2026-04-26: Plan drafted post-audit. Order ledger schema, status
  enum, controller, ledger service, AgentEvent enums, and Trading UI
  Acknowledge button location all confirmed. Note column choice
  (additive metadata, not a state change) anchored in the
  no-state-machine-fragmentation argument.

## Final outcome

(Filled after merge.)
