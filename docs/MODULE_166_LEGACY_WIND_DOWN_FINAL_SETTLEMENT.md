# Module 166 — Legacy Wind-Down & Final Settlement

Status: implemented on `feature/module-166/legacy-wind-down-final-settlement` (base: M165 merge `18bfc06`). **Verdict: PARTIAL — BLOCKED BY DECISIONS.** Default behaviour of the application: **unchanged**. This module adds a **read-only inventory and readiness report** for the legacy quote/payment flow. It changes no legacy behaviour, adds no schema, migration, environment variable, feature flag or second cutover switch, enables no live payment, and **does not pass Gate C** and does not claim it. It is not legal, tax or accounting advice.

## 1. Scope and explicit non-goals

M166 prepares the controlled wind-down of the legacy flow (`flowVersion = LEGACY_QUOTE_PAYMENT`) and makes "is anything legacy still open?" answerable from persisted facts, repeatably and without side effects.

What was built (all read-only): a pure rule set (`domain/services/legacy-wind-down.ts`), a query-only port (`domain/repositories/legacy-wind-down-reader.ts`), a Prisma adapter that reads in one `READ ONLY` / `REPEATABLE READ` transaction (`prisma-legacy-wind-down-reader.ts`), one use case (`GenerateLegacyWindDownReportUseCase`), a plain-factory composition root, and an operator script (`npm run legacy-wind-down-report [-- --json]`).

Non-goals (kept intact, in this order):

- **M167** — Legacy Archive & Retention Export: not done. **M168** — Legacy Code Removal: not done; no legacy code, route, webhook, cron or subscriber was removed or disabled. **M169** — Legacy Schema Retirement: not done; no table, column or enum was touched. **Gate D** — not claimed.
- **Gate C** — not passed and not claimed (§8).
- No settlement engine: M166 never captures, refunds, pays out, issues, cancels, resolves or marks anything. Settlement stays in the existing legacy use cases.
- No new ledger, payment state machine, settlement model or table.
- No change to M132 pilot categories, M164 enabled territory/category combinations, M159 `LEAD_V1_ROLLOUT_MODE`, any production flag or any live payment configuration.
- No invented retention period, notice period, deadline, "quiet period", legal conclusion, balance, settlement amount, payment/refund status or provider confirmation.
- The professional's job payment is never held or routed by MaestroYa under LEAD_V1 (M121 boundary, untouched). This report concerns only the *legacy* flow, in which MaestroYa did hold the customer's payment; it adds nothing to that.

## 2. Verified legacy lifecycle map

"Verified" = read in the repository at HEAD `18bfc06`. Anything not verified is marked **assumption** or **open question**.

| Area | Verified facts |
|---|---|
| Entry points | `/requests/new` → `createServiceRequestAction` → `CreateServiceRequestUseCase` (flow `LEGACY_QUOTE_PAYMENT`), wrapped by `LegacyRequestCreationGuarded`, which (M165) refuses a category whose default is LEAD_V1 (M159 ENTRY open **and** M132 pilot category). Every other category stays legacy. `CreateQuoteUseCase` (guard `quote.create`) needs a `PUBLISHED` request. Quote acceptance is one transaction that moves `PUBLISHED`→`ACCEPTED` (restricted to the legacy flow in the `where`), rejects the other open quotes and creates the `Job` (`CREATED`) and its appointment. |
| In-flight states | Request `DRAFT/PUBLISHED/QUOTED/ACCEPTED/IN_PROGRESS/COMPLETED/CANCELLED/EXPIRED/DISPUTED`; quote `PENDING/SENT/VIEWED/ACCEPTED/REJECTED/EXPIRED/WITHDRAWN`; job `CREATED/IN_PROGRESS/COMPLETED/CANCELLED`; completion confirmation `WAITING_FOR_CUSTOMER/CONFIRMED/DISPUTED/TIMED_OUT_UNDER_REVIEW` with release `PENDING/RELEASE_APPROVED/RELEASE_HELD/RELEASE_DENIED`. **Finding:** no code writes a request status of `QUOTED`, `IN_PROGRESS` or `COMPLETED`; after acceptance a request rests at `ACCEPTED` and the **Job** is the authoritative lifecycle object (pinned by a test). |
| Financial states and authoritative evidence | `Payment` `PENDING/AUTHORIZED/CAPTURED/FAILED/CANCELLED/REFUNDED/PARTIALLY_REFUNDED`. Every transition is driven by the Stripe webhook (`/api/webhooks/stripe-payments`, `ProcessCustomerPaymentWebhookUseCase`, ledger provider key `STRIPE_PAYMENTS`); a client confirmation never settles anything. `Payout` `PENDING/IN_TRANSIT/PAID/FAILED/CANCELLED/REVERSED` (idempotent per job, locked, retryable). Commission is recorded on capture. Self-billed `Invoice` `DRAFT→PENDING_ACCEPTANCE→ACCEPTED→ISSUED→PAID` (`PAID` on payout), `CUSTOMER_RECEIPT` is issued from `DRAFT`. |
| Refund / dispute paths | `ExecuteRefundUseCase` (+ payout reversal), `FinancialAdjustment`, `DisputeResolutionDecision`, customer `Dispute` (only `CLOSED` is terminal; `RESOLVED` and `REJECTED` are not), provider `StripeDispute` (`NEEDS_RESPONSE/UNDER_REVIEW/WON/LOST/WARNING_CLOSED`). A lost chargeback whose adjustment cannot be recorded is closed `LOST` **with no adjustment** on purpose and flagged for manual reconciliation. |
| Reconciliation / ledger / invoice | Legacy reconciliation (M80/M92): persisted `ReconciliationRun` and `ReconciliationDiscrepancy`, cron `/api/cron/reconciliation-run` (scope from `RECONCILIATION_SCHEDULE_SCOPE`, default `FULL`). **Finding:** a run inspects a *bounded batch* of jobs (scheduled: `RECONCILIATION_SCHEDULE_LIMIT` per invocation with an advancing cursor; manual: a limit with a ceiling), so a `FULL` run is a check scope, not a coverage guarantee. Credit notes are created on refund; legacy invoices/credit notes live in tables separate from the LEAD_V1 lead-fee documents. |
| Affiliate | `AffiliateCommission` rows are derived from the legacy `Commission` (`platformCommissionRefId` = commission id); statuses `PENDING/APPROVED/PAID/CANCELLED/EXPIRED/REVERSED`. The M162 lead-fee reward model is separate and **PARTIAL — blocked by D18**. |
| Safe terminal states | Request `CANCELLED/EXPIRED` (and `ACCEPTED` once its job is terminal); quote `REJECTED/EXPIRED/WITHDRAWN` (and `ACCEPTED` → job); job `COMPLETED/CANCELLED`; payment `FAILED/CANCELLED/REFUNDED`, or `CAPTURED`/`PARTIALLY_REFUNDED` with a `PAID` payout; payout `PAID/CANCELLED/REVERSED`; refund `PROCESSED/REJECTED`; adjustment `APPLIED/REJECTED`; dispute `CLOSED`; Stripe dispute `WON/WARNING_CLOSED/LOST`(with adjustment); invoice `PAID/CANCELLED`; credit note `ISSUED/CANCELLED`. |
| Existing safeguards | M121/M131 mandatory, fail-closed `TransactionFlowGuard` on 11 legacy money operations; `flowVersion` is never reclassified; M159 ENTRY switch and M165 creation guard; idempotency keys on refunds, payouts, adjustments and credit notes; per-job distributed lock on payout/refund; `(provider, eventId)` uniqueness in the webhook ledger; daily `expire-workflows` cron (expires quotes by `validUntil`, requests by `expiresAt`, times out completion confirmations). |
| Missing safeguards / gaps | (1) **Commission never settles:** `CommissionRepository` has no status-mutating method, so a legacy commission stays `PENDING` forever (pinned by a test); M166 therefore does not treat it as an inventory object and invents no settlement for it. (2) No deadline exists for open legacy requests or jobs (D20). (3) `ISSUED` is immutable: a self-billed invoice that will never be paid out can only be corrected by a credit note (accounting decision). (4) No accountant sign-off record or historical close-out export exists. (5) No control expresses "legacy cron routes in no-new-work mode" (§3). (6) Reconciliation coverage cannot be proven from a run (§2, §8). (7) Production counts are unknown to the repository. (8) **Open question:** no automatic expiry of a `PENDING` legacy payment was identified in the paths reviewed; not verified either way. (9) **Assumption:** a `CUSTOMER_RECEIPT` that is `ISSUED` is treated as final (the receipt is never moved to `PAID` by the paths reviewed); confirm with the accountant. |

## 3. Wind-down rules and preserved in-flight paths

Using existing controls only (the M159 ENTRY area and the M165 guard already decide where *new* requests go), M166 changes **no** runtime behaviour. Each candidate stop was evaluated; none is explicitly safe without a decision that is still open.

| Candidate | M166 decision | Why |
|---|---|---|
| New legacy request creation | Unchanged (M165) | Already refused for pilot categories when ENTRY is open. Non-pilot categories remain legacy by design; making them eligible would broaden the M132 pilot, which is out of scope. |
| `CreateQuote` on a `PUBLISHED` legacy request | **Not stopped** | Would strand customers whose published requests are waiting for quotes, before D20 and the notice period are decided. Quotes and requests expire on their own timers. |
| `AcceptQuote`, customer payment initiation | **Not stopped** | Valid in-flight cases need them; there is no per-record "drain" state in the existing controls. |
| Stripe payment webhook route | **Must stay live** | Authoritative confirmation, late disputes and refunds. Grace length is a deferred decision (M168). |
| Completion confirmation, release, payout, refund, dispute, invoice, credit note, reconciliation use cases | **Preserved** | They are how legacy items reach a final state. |
| Legacy cron routes ("no new work" mode) | **Not changed; gap documented** | `expire-workflows` and `reconciliation-run` *close* work; switching them off would block wind-down. Expressing "no new work" would need a new control, which M166 must not introduce silently. |

Conditions that prevent final settlement are exactly the report's blocking codes (§4). Wind-down does not authorise deleting or archiving anything.

## 4. What the report finds

`npm run legacy-wind-down-report` reads one consistent snapshot and returns items, each with an exact count, a status breakdown, exact money per currency (fixed-point, never netted, never summed across items), at most 50 sorted ids, and a **next action that names only paths that already exist** (it never executes them). Blocking codes: `LEGACY_REQUEST_OPEN`, `LEGACY_QUOTE_OPEN`, `LEGACY_JOB_NON_TERMINAL`, `LEGACY_COMPLETION_CONFIRMATION_OPEN`, `LEGACY_PAYMENT_UNCONFIRMED`, `LEGACY_CAPTURED_PAYMENT_WITHOUT_FINAL_DISPOSITION` (CRITICAL, human review), `LEGACY_PAYOUT_NOT_FINAL`, `LEGACY_PAYOUT_REVERSAL_INCOMPLETE`, `LEGACY_REFUND_NOT_FINAL`, `LEGACY_FINANCIAL_ADJUSTMENT_NOT_FINAL`, `LEGACY_DISPUTE_DECISION_NOT_APPLIED`, `LEGACY_DISPUTE_NOT_CLOSED`, `LEGACY_STRIPE_DISPUTE_OPEN`, `LEGACY_STRIPE_DISPUTE_LOST_WITHOUT_ADJUSTMENT`, `LEGACY_INVOICE_NOT_FINAL`, `LEGACY_CREDIT_NOTE_NOT_FINAL`, `LEGACY_AFFILIATE_COMMISSION_OPEN`, `LEGACY_WEBHOOK_EVENT_UNSETTLED`, `LEGACY_FINAL_RECONCILIATION_MISSING`, `LEGACY_FINAL_RECONCILIATION_STALE`, `LEGACY_RECONCILIATION_RUN_IN_PROGRESS`, `LEGACY_RECONCILIATION_DISCREPANCIES_OPEN`, `LEGACY_AMOUNT_UNPARSEABLE`.

A captured payment has a **final disposition** only if a payout for it is `PAID`. It is *in flight* (covered by another item) while its job is open, its release is `PENDING/RELEASE_HELD`, or a linked payout is not final. Anything else (approved release but no payout, denied release but still captured, no job) is flagged for a person; the report derives no amount and decides nothing.

Context facts are reported without judgement: total legacy requests, the newest legacy request's creation time (no period is applied), the latest legacy financial change, and the latest `COMPLETED` `FULL` reconciliation run with its raw `recordsInspected`.

## 5. Settlement / reconciliation invariants

1. **Read-only.** The port has one query method; the adapter issues only `findMany`, `findFirst`, `count`, `aggregate`; the transaction starts with `SET TRANSACTION READ ONLY` (the database refuses writes) and is `REPEATABLE READ`, so all kinds are seen at one point in time (static + unit tests).
2. **Flow boundary preserved.** Every query on a table with a service-request relation filters on `flowVersion = LEGACY_QUOTE_PAYMENT`; nothing reclassifies a request or purchase. Tables without that relation (payouts, provider disputes, affiliate commissions, webhook events) are legacy-only by construction (M121/M131 guard; the lead-fee flow has its own tables and its own webhook provider key).
3. **Fail closed.** A database error, an unavailable engine or an inventory kind above its ceiling (default 50 000 rows) raises an error; the script exits `2` and prints no report. A subset is never reported as the whole, and an empty result is never fabricated from a failure.
4. **Authoritative evidence only.** No status is inferred from a browser redirect or client event: the report reads persisted statuses written by the existing authoritative paths (webhook-driven payments, provider transfer results).
5. **No invented numbers.** Amounts are exact 2-decimal strings; unparseable amounts are excluded from totals and reported (`LEGACY_AMOUNT_UNPARSEABLE`); an affiliate total is shown under `NO_CURRENCY_ON_RECORD` because that row has no currency; refund currency is the payment's.
6. **Never "ready".** The decision is `NOT_READY` or `DATA_CLEAN_PENDING_SIGN_OFF`; there is no `READY` value. Every report lists the external confirmations (D20, disputed/unpaid handling, notice period, Gate B, zero-new-requests period, late-dispute grace window, reconciliation coverage, accountant sign-off) as `NOT_VERIFIABLE_FROM_REPOSITORY`.
7. **No party data.** Names, tax ids, addresses, notes and free text are never selected.
8. **Preserve history.** Nothing is deleted or altered; resolving a discrepancy still requires the existing resolve-discrepancy use case with a reason.

## 6. Idempotency and failure behaviour

The report is a pure function of one snapshot: the same data yields the same items in the same order (only `generatedAt` differs), so repeating it, running it concurrently or running it after a retry has **no financial effect** and takes no lock. Duplicate webhooks, retries and repeated settlement runs remain governed by the existing mechanisms (webhook ledger uniqueness, idempotency keys, per-job locks), which M166 does not modify. A run that races with live writes sees a consistent point-in-time view and may be stale a moment later; `LEGACY_FINAL_RECONCILIATION_STALE` compares the latest `COMPLETED` `FULL` run's start with the latest legacy financial change. Script exit codes: `0` report produced and no blocking finding (still **not** Gate C); `1` blocking findings exist; `2` report could not be produced.

## 7. Outstanding financial and operational obligations

**Unknown to the repository.** Production counts and amounts: the report must be run deliberately against the real database to produce them (it is safe by construction, but it is an operator tool; not run by this task). Until then the obligations are structural: open requests/quotes/jobs; unconfirmed payments; captured payments without a final disposition; non-final payouts, refunds, adjustments, disputes and chargebacks; non-final invoices and credit notes; open affiliate commissions; unsettled webhook events; and reconciliation state.

## 8. Gate C readiness criteria and unresolved blockers

| Criterion (roadmap) | Evidence | Status |
|---|---|---|
| Zero non-terminal legacy objects | M166 report (data side) | Cannot be answered without running it on production data |
| Final legacy reconciliation has no unresolved discrepancies | Report: FULL run present, not stale, no OPEN discrepancies; **plus** coverage confirmation | Data side: reportable. Coverage: **human** |
| Accountant sign-off recorded | No record exists | **Open** |
| Zero new legacy requests for a defined period (M165 exit) | Report shows the newest legacy request time | **Period undefined** |
| Gate B passed | No repository document records it (M159 §10, M161 §13 say not approved) | **Not passed** |
| M162 affiliate reward model | `PARTIAL — blocked by D18` | **Blocked** |
| D20 (retention; open legacy requests/jobs) | Unresolved (M160, M161, M165 §9) | **Decision required** |
| Handling of disputed or unpaid legacy items; customer/professional notice period | Unresolved | **Legal/business decision required** |
| M165 routing follow-ups (non-pilot categories dead-end; `?categoryId`/`?city` not carried; territory enforced at publication, not at flow selection) | Documented in M165 §8; not changed since | **Open** (M166 must not broaden the pilot) |

**M166 does not pass Gate C and does not claim it.**

## 9. Migration and rollback

No schema change, migration, environment variable or flag. Deployment is inert: nothing calls the report except the script. Rollback = revert the M166 files and the one `package.json` script line. The report never writes, so there is no data to undo.

## 10. Tests and limitations

Test evidence (run in a Linux scratch mirror of the working tree, because the sandbox VM cannot run the repository's macOS `node_modules`; the repository itself was not modified by the test runs):

| Check | Command | Result |
| --- | --- | --- |
| Baseline unit suite (before M166) | `npx vitest run` in 6 shards | 731 files, 8125 tests passed; `tests/unit/next.config.test.ts` could not load (`@parcel/watcher` has no Linux binary) |
| M166 targeted tests | `npx vitest run` on the 4 new M166 test files | 72 tests passed (32 domain, 5 use case, 15 reader, 20 boundary) |
| Full unit suite (with M166) | `npx vitest run` in 6 shards | 735 files, 8197 tests passed (8125 + 72); only `next.config.test.ts` failed to load, identical to baseline |
| Type check | `npx tsc --noEmit` | exit 0 |
| ESLint | `npx eslint` on the 10 changed/new TS files | exit 0 |
| Whitespace | `git diff --check` (tracked change) | exit 0; the new untracked files were checked with `git diff --no-index --check` and reported no whitespace problems (that command exits 1 whenever files differ) |
| Prisma validation | not run | the Prisma schema and migrations are unchanged |
| Integration tests | not run | no verified disposable local PostgreSQL was available |

Limitations:

- Every shard reported unhandled `PrismaClientInitializationError` entries (a macOS-generated Prisma client loaded in a Linux sandbox). The same set of test files produced them in the baseline and in the final run; none originate from M166 tests, which mock the Prisma client module and never start the engine. They are baseline/environmental, not regressions.
- `tests/unit/next.config.test.ts` fails to load in the sandbox in both baseline and final runs (environmental).
- The report script and `PrismaLegacyWindDownReader` were **not executed against any real database**. The reader is verified only by fake-transaction unit tests (any non-read method throws), static boundary tests and `tsc`. Its behaviour against real PostgreSQL (query plans, the READ ONLY / RepeatableRead transaction, timeouts) is unverified.
- No database reset, seed, migration or test command was run against production or Supabase.
