# MODULE 70.1 — Pre-Stripe Security & Integration Hardening

## Executive Summary

Module 70.1 closes the P0/P1 findings the Module 70 audit brief described, so the Persona/KYC integration and financial payout-readiness boundary are safe dependencies for Module 71 (Stripe Connect). No Module 70 audit report existed on disk in this repository at the start of this session (`MODULE_69_IMPLEMENTATION_REPORT.md` was the most recent), so this module worked directly from the seven objectives (A–G) in its own brief, tracing the actual Module 59 (Persona), Module 66 (Job Completion & Payment Release), Module 68 (Dispute Resolution), and Module 69 (Financial Ledger & Payout Readiness) implementations in source rather than trusting documentation.

**No Stripe code was written.** Every change reuses an existing abstraction — `VerificationProvider`, `RefreshVerificationStatusUseCase`, `ProfessionalVerificationRepository.findByProviderVerificationId`, `requireRole`/RBAC, `CheckPayoutReadinessUseCase`, `ReconcileProfessionalEarningsUseCase` — none were rewritten, only completed (a missing caller/route) or hardened (auth, replay protection, idempotency, tests).

Seven changes, in order of the module's own objectives:

1. **Persona webhook route** (`POST /api/webhooks/persona`) — did not exist; the audit's CRITICAL finding.
2. **Verification synchronization reachability** — the route now reaches `RefreshVerificationStatusUseCase` via a new thin use case, resolving Persona's inquiry id against this platform's own record (never trusting the webhook body's user-facing id).
3. **Provider-independent external-event idempotency** — one new table (`external_webhook_events`), one new repository interface, DB-unique-constraint-backed.
4. **Payout readiness / reconciliation proof** — 24 new integration tests directly exercising `CheckPayoutReadinessUseCase` and `ReconcileProfessionalEarningsUseCase` (previously untested).
5. **Segregation of duties** — `resolveDisputeWithFinancialOutcomeAction` no longer grants `SUPPORT`.
6. **Health endpoint hardening** — `/api/health/diagnostics` and `/api/health/circuit-breakers` now require `ADMIN`/`SUPER_ADMIN`.
7. **HTTP-level tests** — new wiring tests for the webhook route and both hardened health routes; one pre-existing health-route wiring test file updated to authenticate now that those routes require it.

## Module 70 Findings Closed

No `MODULE_70_..._REPORT.md` existed to enumerate a numbered findings table against, so each objective (A–G) from this module's own brief is treated as the finding it names itself after.

| Objective | Original problem | Root cause | Implementation | Verification | Status |
|---|---|---|---|---|---|
| A — Persona webhook | No Route Handler ever called `PersonaVerificationProvider.webhookValidation` | Module 59 shipped signature verification but explicitly scoped webhook *processing* out (`WebhookValidationResult`'s own doc comment: "no route actually calls it yet") | `src/app/api/webhooks/persona/route.ts` — thin controller: read raw body → `verificationProvider.webhookValidation` → `ProcessPersonaWebhookUseCase` → response | 9 HTTP-level tests (`tests/unit/app/api/webhooks/persona-route.test.ts`) + 13 signature-verification unit tests + 9 use-case integration tests | **CLOSED** |
| B — Synchronization reachable | `SynchronizeVerificationUseCase` was batch-only; no per-event path existed | Module 59's brief batch/on-demand split never anticipated a webhook | `ProcessPersonaWebhookUseCase` resolves the event's inquiry id via `ProfessionalVerificationRepository.findByProviderVerificationId`, then calls `RefreshVerificationStatusUseCase.execute(verification.id)` — the exact same use case the professional's own "check status" button and the batch sync already call | `tests/integration/verification/persona-webhook-flows.test.ts` — VERIFIED, REJECTED, NEEDS_REVIEW, unknown-outcome cases | **CLOSED** |
| C — External-event idempotency | No provider-independent idempotency mechanism existed anywhere in the codebase | Never built — Module 59 didn't need it (no webhook processing existed) | New `ExternalWebhookEventRepository` port + `external_webhook_events` table, `(provider, externalEventId)` DB-unique | Duplicate-delivery and concurrent-duplicate-delivery tests, both passing | **CLOSED** |
| D — Payout readiness / reconciliation proof | `CheckPayoutReadinessUseCase`/`ReconcileProfessionalEarningsUseCase` had zero production caller and zero dedicated tests (only the pure `decidePayoutReadiness` function was tested) | Module 69 built the contract but deferred proving the use-case-level wiring (repos, KYC gate, trust hold, payout ledger) to a later module | 24 new integration tests, real use cases + fakes | All 24 pass | **CLOSED** |
| E — Segregation of duties | `resolveDisputeWithFinancialOutcomeAction` allowed `SUPPORT` to single-handedly resolve a dispute AND authorize its financial adjustment | Module 68 mirrored the broader dispute-triage role set onto the one financial-outcome action without a dedicated review | `requireRole(ADMIN, SUPER_ADMIN)` only, on that one export; every triage-only action in the same file keeps `SUPPORT` | 4 new authorization tests | **CLOSED** |
| F — Persona env hardening | `PERSONA_WEBHOOK_SECRET` was optional even in production with `VERIFICATION_PROVIDER=persona` | Module 59 built the webhook-secret field before any route consumed it, so no production check existed yet | New `.superRefine` branch in `env.ts`, mirroring the existing `PERSONA_API_KEY`/`PERSONA_TEMPLATE_ID` check | 4 new env tests (+ a pre-existing gap fixed: `env-fixture.ts`'s `loadEnvWith` never reset `VERIFICATION_PROVIDER`/`PERSONA_*` between test cases — fixed alongside) | **CLOSED** |
| G — Health endpoint exposure | `/api/health/diagnostics` and `/api/health/circuit-breakers` (GET+POST) were fully unauthenticated, exposing subsystem/dependency/breaker topology, and `POST` let anyone force a breaker reset | Module 56 deliberately left every `/api/health/**` route open; no later module revisited that decision once these two routes started returning topology detail | `requireRole(ADMIN, SUPER_ADMIN)` on both routes, both methods, reusing the exact seam `/api/analytics/dashboard` already established | 10 new HTTP-level tests + 8 existing wiring tests updated to authenticate | **CLOSED** |

## Persona Webhook Architecture

```
Persona
  -> POST /api/webhooks/persona                          (src/app/api/webhooks/persona/route.ts)
       - request.text() -> raw body, never parsed early
       - header "persona-signature"
  -> PersonaVerificationProvider.webhookValidation(rawBody, header)   (existing Module 59 class, extended)
       - HMAC-SHA256(secret, `${t}.${body}`), timing-safe compare
       - [NEW] non-hex signature rejected before ever reaching timingSafeEqual
       - [NEW] replay protection: |now - t| > 5 minutes -> invalid
       - parses the outer Persona Event envelope: event id, event type,
         embedded Inquiry (id + status) if present
  -> (invalid) -> 401, generic message, no processing
  -> (valid, no event id) -> 200 "ignored", no processing
  -> ProcessPersonaWebhookUseCase.execute({ externalEventId, eventType, providerVerificationId })
       (src/core/application/use-cases/verification/process-persona-webhook.use-case.ts, NEW)
       1. ExternalWebhookEventRepository.claim("PERSONA", externalEventId)
            -> not claimed (duplicate/in-flight/already-processed) -> "duplicate", stop
       2. no providerVerificationId -> mark processed, "ignored", stop
       3. ProfessionalVerificationRepository.findByProviderVerificationId(providerVerificationId)
            -> null (never issued by this platform) -> mark processed, "unmatched", stop
       4. RefreshVerificationStatusUseCase.execute(verification.id)     (existing Module 59 use case, UNCHANGED)
            - re-fetches the inquiry's status from Persona's own API
              (VerificationProvider.refreshStatus) -- the webhook body's
              embedded status is never itself applied
            - resolveProviderStatusTransition + canTransition gate every
              write, exactly as they already did for the manual "check
              status" button and the batch SynchronizeVerificationUseCase
       5. mark processed (or mark failed + rethrow, on any error)
  -> ProfessionalVerification.status                     (existing Module 59/17 aggregate, UNCHANGED)
  -> 200 { status: outcome }                              (every non-exceptional outcome is 200 — nothing here should ever cause Persona to retry)
```

No Persona-specific type, status string, or JSON shape crosses into `ProcessPersonaWebhookUseCase` or the Route Handler — both only ever see the already-normalized `externalEventId`/`eventType`/`providerVerificationId` fields `webhookValidation` extracted.

## Idempotency Design

**Uniqueness invariant:** `(provider, externalEventId)` is a Postgres unique index on the new `external_webhook_events` table (migration `20260901000000_add_external_webhook_event_idempotency`). `provider` is a free-form string (`"PERSONA"` today), never an enum tied to Persona — a future `/api/webhooks/stripe` reuses the exact same table and repository interface with `provider: "STRIPE"`, no schema change.

**Concurrency:** `claim()` always attempts the `INSERT` first — there is no "check, then insert" window at all. Two concurrent deliveries of the same event race the same `INSERT`; Postgres's unique index lets exactly one succeed. The loser catches the unique-violation, and (per the retry rule below) either reclaims a `FAILED` row or observes `claimed: false`.

**Retries:** if `ProcessPersonaWebhookUseCase` throws after claiming (e.g. `RefreshVerificationStatusUseCase` hits a transient Persona API failure), the event is marked `FAILED`. A `FAILED` event — and only a `FAILED` event — may be reclaimed by a later delivery, via an `UPDATE ... WHERE status = 'FAILED'` guarded the same optimistic-concurrency way every other status transition in this codebase already is (e.g. `PrismaDisputeResolutionDecisionRepository.transition`). This matches how Persona (and every other webhook provider) actually behaves: a non-2xx response triggers their own retry.

**Duplicate delivery:** a `PROCESSING` (in-flight, possibly concurrent) or `PROCESSED` (already completed) event can never be reclaimed — `claim()` returns `claimed: false` and the route acknowledges with 200 (never a re-processed side effect, never an error that would make the sender retry something that doesn't need retrying).

**Failed processing:** never silently dropped — the event row's `status` stays queryable/observable as `FAILED` for as long as no successful retry has landed, giving an operator a real signal distinct from "never delivered" or "processed."

### A note on `prisma generate`

`prisma generate` could not be run against this schema change in this sandbox — see Verification, below. `PrismaExternalWebhookEventRepository` is therefore written against `prisma.$queryRaw`/`$executeRaw` with bound parameters (an existing, precedented pattern in this codebase — see `PrismaPlatformAnalyticsRepository`) rather than `prisma.externalWebhookEvent.*`. The migration and table shape are unaffected; once `prisma generate` can run against a Linux target in a real deployment, this one file can be trivially rewritten against the typed model delegate with identical behavior.

## Payout Readiness Verification

`CheckPayoutReadinessUseCase` — 16 tests (`tests/integration/financial/payout-readiness-flows.test.ts`), all real use case + fake repositories:

| # | Scenario | Status asserted |
|---|---|---|
| 1 | Every condition satisfied | `eligible`, payableAmount = 1350 |
| 2 | `RELEASE_HELD` (open dispute) | `held` |
| 3 | No completion confirmation yet | `pending` |
| 4 | `RELEASE_APPROVED` but KYC never started | `pending` |
| 5 | Active `PAYOUT_HOLD` on an otherwise-eligible payout | `held` |
| 6 | `RELEASE_DENIED` | `denied`, payableAmount 0 |
| 7 | Fully refunded via an applied adjustment | `insufficient_balance`, 0 |
| 8 | Commission/ledger amount mismatch | `financial_inconsistency` |
| 9 | Already-paid exceeds recognized earnings | payableAmount clamped to 0, never negative |
| 10 | Partial already-paid amount | payableAmount netted correctly (1350 − 500 = 850) |
| 11 | Payout amount vs. reconciled earnings | payableAmount never exceeds the reconciled 1350 |
| 12 | Inconsistency + active hold + (would-be) denial together | `financial_inconsistency` wins (highest priority) |
| 13 | Active hold vs. every other favorable input | `held`, unconditionally |
| 14 | `RELEASE_APPROVED` (as if admin-overridden) + active hold | `held` — hold is never bypassable |
| 15 | Company-owned job (`professionalProfileId` null) | `held`, `paymentId: null` — conservative, unchanged limitation |
| — | Nonexistent job | `NotFoundError` |

**Priority ordering verified** (test #12, mirroring `decidePayoutReadiness`'s own documented order): financial inconsistency → permanent denial → Trust & Integrity hold (never bypassable, tests #13/#14) → release held → release pending → KYC pending → balance check.

`ReconcileProfessionalEarningsUseCase` — 8 tests: rollup across one payment, netting already-paid, netting a refund adjustment, summing across two independent jobs for the same professional, zero-earnings professional, surfacing one inconsistent payment without hiding the rest of the rollup, a read-only-mutation check (nothing it reads is ever changed), and `NotFoundError` for an unknown professional.

## Segregation of Duties

**Decision: SUPPORT loses financial-outcome authority.** `resolveDisputeWithFinancialOutcomeAction` (`src/app/(dashboard)/admin/disputes/actions.ts`) now requires `ADMIN`/`SUPER_ADMIN` only — `ROLES.SUPPORT` was removed from that one export's `requireRole` call.

Rationale (see the action's own updated doc comment for the full text):
- SUPPORT keeps every triage action in the same file (assign, internal note, status change, non-financial `resolveDisputeAction`, close) — only the one action that *authorizes a real financial adjustment* is narrowed.
- `ResolveDisputeWithFinancialOutcomeUseCase` itself is unchanged — it takes an already-authorized `adminUserId` and never reads or branches on the caller's role. The fix is entirely at the Server Action authorization boundary, the same place every other role check in this codebase already lives — no use-case assumption changed.
- Existing detective controls (the `DisputeResolutionDecision` row, the append-only financial ledger `Transaction` rows the adjustment produces) are untouched and now sit behind this narrower preventive control too, not replaced by it.

Compensating controls beyond the role narrowing itself: none were added because none were needed — the existing audit trail (Module 68's `DisputeResolutionDecision`, Module 22's append-only ledger) already fully attributes every financial adjustment to the deciding `adminUserId`.

## Security Review

- **Authentication:** the webhook route performs zero side effects (no DB read, no use-case call) before `webhookValidation` returns `valid: true`. Both hardened health routes call `requireRole` as their first statement, before even the cheap `HEALTH_CHECKS_ENABLED` check.
- **Authorization:** `resolveDisputeWithFinancialOutcomeAction` now requires `ADMIN`/`SUPER_ADMIN`; `/api/health/diagnostics` and `/api/health/circuit-breakers` (GET+POST) now require the same.
- **Replay protection:** `PersonaVerificationProvider.webhookValidation` now rejects any signature whose `t=` timestamp is more than 5 minutes from the current time (in either direction) — a captured, genuinely-valid body+signature pair can no longer be replayed later. Also rejects non-numeric timestamps and non-hex signatures outright (previously `Buffer.from(sig, "hex")` would silently truncate a malformed signature rather than reject it).
- **IDOR/BOLA:** the webhook never trusts a client-supplied user/professional id. `ProcessPersonaWebhookUseCase` resolves Persona's own `Inquiry.id` against `ProfessionalVerificationRepository.findByProviderVerificationId` — an id this platform never issued/recorded is acknowledged as `"unmatched"`, never treated as a match. The actual status transition is driven by a fresh, server-initiated `refreshStatus` call to Persona, never by whatever the webhook body itself claimed.
- **Race conditions:** concurrent duplicate webhook delivery is DB-unique-constraint-safe (see Idempotency Design). Verified with a real `Promise.all` concurrent-delivery test.
- **Secrets:** `PERSONA_WEBHOOK_SECRET`/`PERSONA_API_KEY` are never logged anywhere in the new code. The webhook route logs only request id, outcome, event id, and event type — never the raw body or the signature header value.
- **Error handling:** the webhook route and both health routes route every unexpected error through the existing `toHttpErrorResponse` (masks internals in production, never a stack trace, never a Prisma error message).
- **Health endpoint exposure:** now gated exactly as described above; `/api/health` and `/api/health/ready` remain intentionally public liveness/readiness probes, unchanged.

## Database Changes

One new migration, purely additive:

- `prisma/migrations/20260901000000_add_external_webhook_event_idempotency/migration.sql` — one new enum (`ExternalWebhookEventStatus`), one new table (`external_webhook_events`) with a unique index on `(provider, "externalEventId")` and a supporting `(provider, status)` index. No existing table, column, or row touched.

`schema.prisma` gained the corresponding `ExternalWebhookEvent` model + enum, appended at the end of the file.

## Tests

**New:**
- `tests/integration/verification/persona-webhook-flows.test.ts` — 9 tests, `ProcessPersonaWebhookUseCase` end to end (VERIFIED/REJECTED/NEEDS_REVIEW/unknown outcomes, duplicate delivery, concurrent duplicate delivery, ignored/unmatched events, failed-then-retried delivery).
- `tests/integration/financial/payout-readiness-flows.test.ts` — 24 tests (see Payout Readiness Verification above).
- `tests/unit/app/api/webhooks/persona-route.test.ts` — 9 HTTP-level tests for the new Route Handler.
- `tests/unit/app/api/health/diagnostics-route.test.ts` — 4 HTTP-level tests.
- `tests/unit/app/api/health/circuit-breakers-route.test.ts` — 6 HTTP-level tests (GET + POST).
- `tests/unit/app/admin-disputes-actions.test.ts` — 4 authorization tests for the Objective E fix.
- 7 new/extended cases in `tests/unit/core/infrastructure/verification/persona-verification-provider.test.ts` (event id/type parsing, replay-protection rejection, malformed-timestamp rejection, malformed-signature rejection).
- 4 new cases in `tests/unit/core/infrastructure/config/env.test.ts` (`PERSONA_WEBHOOK_SECRET` production hardening).

**Fakes added** (`tests/integration/financial/fakes.ts`): `FakeTrustAutomatedActionRepository`, `FakeProfessionalPayoutLedgerRepository`.

**Existing, updated (behavior legitimately changed, not weakened):**
- `tests/integration/health/health-routes-wiring.test.ts` — 5 of its existing tests exercised `/api/health/diagnostics`/`/api/health/circuit-breakers` with no auth mock; now that those routes require `ADMIN`/`SUPER_ADMIN`, each was updated to `vi.doMock("@/lib/auth", ...)` an ADMIN session, using the exact same `vi.doMock`/`vi.resetModules()` pattern that file already used for the Prisma client mock. Every original assertion is unchanged.
- `tests/unit/core/infrastructure/verification/persona-verification-provider.test.ts` — the two tests that hardcoded `timestamp = "1700000000"` (now far outside the new 5-minute replay tolerance) were updated to a dynamic `Date.now()`-based timestamp; a dedicated new test asserts that same old timestamp is now correctly rejected as a replay.
- `tests/unit/core/infrastructure/config/env-fixture.ts` — `ENV_KEYS` was missing `VERIFICATION_PROVIDER`/`PERSONA_*` entirely (a pre-existing gap, unrelated to any one prior module), meaning `loadEnvWith` never reset those variables between test cases. Fixed alongside the new PERSONA_WEBHOOK_SECRET tests that would otherwise have been the first to depend on correct isolation.

No test was deleted. No existing assertion was weakened or removed — only updated where the underlying, intentional security behavior actually changed.

## Verification

| Command | Result | Notes |
|---|---|---|
| `npx tsc --noEmit -p tsconfig.json` (full project) | **PASS** | 0 errors |
| `npx eslint .` (full project) | **PASS** | 0 errors/warnings |
| `npx vitest run` (entire suite) | **PASS** | 505 test files, 4163 tests, 0 failures. 12 unhandled-rejection warnings logged during the run, all the same pre-existing, already-documented `PrismaClientInitializationError` (client generated for `darwin-arm64`, sandbox needs `debian-openssl-3.0.x`) described by `tests/unit/prisma_probe.test.ts` (left in the repo from a prior module) — confirmed pre-existing by reproducing against files this module never touched (e.g. `tests/unit/app/seo/*`). None of the 4163 test results were affected. |
| `npm run build` | **PARTIAL — ENVIRONMENT-BLOCKED at static export, not at typecheck/lint** | With a full placeholder env supplied, the build reached "Linting and checking validity of types" and "Collecting page data" successfully (both **PASS** — this is real evidence tsc/ESLint pass under Next's own build-time checker, not just the standalone commands above), then failed prerendering `/sitemap.xml`, which makes a live `prisma.professionalProfile.findMany()` call at build time — the same `debian-openssl-3.0.x` query-engine mismatch as above. Not a code defect. |
| `npx prisma generate` | **ENVIRONMENT-BLOCKED** | `403 Forbidden` fetching the schema-engine binary from `binaries.prisma.sh` — this sandbox has no route to that host. Same constraint Module 69's own report documents. Also attempted from the user's local device-bridge Linux VM (a different sandbox with a different, also-unreachable engine target) — same result. `node_modules/.prisma/client` in both sandboxes is the pre-existing `darwin-arm64`-generated client, copied in for typecheck/IDE purposes only; the new `ExternalWebhookEvent` model was therefore implemented via `$queryRaw`/`$executeRaw` (see Idempotency Design) rather than the typed model delegate. |
| `npx prisma validate` / `npx prisma migrate status` | **ENVIRONMENT-BLOCKED** | Same `binaries.prisma.sh` 403. The new migration's SQL was manually reviewed against Postgres syntax and against five prior hand-authored migrations in this same repo (most recently `20260825000000_add_refund_boundedness_guard`) as precedent; not machine-validated against a live database in this session. |

**Focused test runs** (all passing, run individually before the full-suite run above): Persona provider/webhook (22 tests across 2 files), external-event idempotency (9 tests, part of persona-webhook-flows.test.ts), payout readiness (24 tests), reconciliation (8 of the above 24), dispute authorization (4 tests), health endpoints (10 new + 8 updated existing = 18 tests), env hardening (75 tests, env.test.ts in full).

No command's failure was hidden or reported as a false PASS.

## Remaining Risks

1. **`prisma generate`/`migrate status`/`validate` never ran against a real database or a Linux-targeted client in this session** — see Verification above. The migration SQL is hand-authored and reviewed, not machine-validated. Run `npx prisma migrate deploy` (or `migrate dev` in a scratch environment) against a real Postgres instance before merging, exactly as this module's own instructions require rather than assuming success.
2. **`PrismaExternalWebhookEventRepository` is raw-SQL, not the typed Prisma delegate** — functionally complete and tested via its Prisma-shaped fake counterpart in the integration test suite, but not exercised against a live `PrismaClient` instance for `ExternalWebhookEvent` specifically in this session (no reachable database). Once `prisma generate` can run for real, consider (not required) rewriting it against `prisma.externalWebhookEvent.*` for consistency with the rest of the codebase — behavior is identical either way.
3. **`npm run build`'s static export was not completed** — typecheck and lint passed inside the real build pipeline; final static-page generation was blocked by the same engine-platform mismatch, not exercised end to end. Recommend re-running `npm run build` in a normal Linux CI/deploy environment (where `prisma generate` can actually reach `binaries.prisma.sh` or a private mirror) before merging.
4. **Objective B's "unhandled provider status fails safely" claim rests on `resolveProviderStatusTransition`/`canTransition`, unchanged by this module** — verified by test, not re-derived; this module deliberately did not touch that logic (per its own "no duplicated KYC logic" rule).
5. **No compensating control beyond role narrowing was added for Objective E** — judged unnecessary given the existing audit trail (see Segregation of Duties). If a future module wants a stronger control (e.g. dual sign-off for the largest-amount adjustments), that is a genuinely new feature, out of this module's "no unnecessary abstractions" scope.

## Stripe Readiness Decision

**GO** — with the explicit condition that `npx prisma migrate deploy` (Remaining Risk #1) is run against a real Postgres instance, in an environment with real network access to fetch the correct platform's Prisma engine, before Module 71 begins. Every other success criterion in this module's own checklist is met and verified by a passing automated test; the one gap that could not be closed inside this sandbox is a network/environment constraint identical to the one Module 69's own report already documented and deferred the same way, not a defect in this module's implementation.
