# Module 72 — Stripe Webhooks Implementation Report

> **POST-AUDIT ADDENDUM (see `MODULE_72_AUDIT_REPORT.md` for the full adversarial audit):**
> The original version of this report described the out-of-order-delivery guard (§8/§16 below) as "best-effort, non-transactional." A subsequent audit investigated whether a genuinely atomic guard was achievable without a schema change, found that it was, and implemented it: `ProfessionalOnboardingRepository.updateStripeConnectAccountIfNotStale` now performs the out-of-order comparison and the write in a single atomic `updateMany` statement (`WHERE stripeConnectSyncedAt IS NULL OR <= :incoming`), closing the race window the original implementation disclosed. The audit also caught and fixed a real off-by-one in that same fix during its own review (an initial `<` guard would have wrongly rejected a legitimate retry of the same event as "stale") — see the audit report for the full account. Every mention of "best-effort"/"non-transactional" out-of-order protection below is superseded by this addendum; §7, §8, and §16 have been updated in place to reflect the corrected implementation.

## 1. Summary

Module 72 adds the Stripe Connect webhook infrastructure that keeps `ProfessionalPayoutAccount`'s Stripe-mirrored fields synchronized with Stripe's own account state, event-driven, on top of Module 71 (Stripe Connect) and Module 70.1 (the provider-agnostic `ExternalWebhookEventRepository` idempotency ledger). The only event processed is `account.updated`; `account.application.deauthorized` was deliberately **not** implemented (see §17 below for why).

No new database table, no new environment variable, no new domain repository. Every piece of state this module writes goes through the exact same `deriveStripeExpressReadiness`/`updateStripeConnectAccount` path Module 71's polling flow (`GetStripeAccountStatusUseCase`) already uses.

## 2. Architecture

```
Domain
  stripe-connect-account-rules.ts          (reused, unchanged)

Application
  ports/stripe-connect-webhook-verifier.ts        (new port — Stripe SDK never crosses this boundary)
  use-cases/stripe-connect/
    process-stripe-connect-webhook.use-case.ts    (new)
    compose.ts                                    (extended)

Infrastructure
  payments/stripe/
    stripe-connect-webhook-verifier.ts             (new — the only file that imports the Stripe SDK for webhooks)
    compose.ts                                     (extended)

Route
  app/api/webhooks/stripe/route.ts                 (new — thin controller)
```

Layering rule verified: `grep -rl "from \"stripe\"" src/core/application` returns nothing — no Stripe SDK type crosses into application or domain code. The only two files that import the `stripe` package for Module 72 are `stripe-connect-webhook-verifier.ts` (infrastructure) and its own unit test.

## 3. Webhook endpoint

`POST /api/webhooks/stripe` — matches this codebase's existing `/api/webhooks/<provider>` convention (`/api/webhooks/persona`), and is the first candidate path this codebase's own `infrastructure/multi-instance-safety/checkers/idempotency-checker.ts` already recognizes for a future Stripe webhook route. Configure this URL in the Stripe Dashboard (or via `stripe listen --forward-connect-to`) with **Events from: "Connected accounts"** — see §13 for exact setup steps. It is intentionally its own route, not merged into `/api/webhooks/persona` or shared with a future platform-scoped ("your account") Stripe endpoint.

## 4. Signature verification

`StripeConnectWebhookVerifierAdapter.verify(rawBody, signatureHeader)` (`infrastructure/payments/stripe/stripe-connect-webhook-verifier.ts`) calls `stripe.webhooks.constructEvent(rawBody, signatureHeader, STRIPE_WEBHOOK_SECRET)` — the same existing, already-required `STRIPE_WEBHOOK_SECRET` env var (no new variable). The route reads the raw body via `request.text()` and hands it to the verifier **before** anything is parsed — `constructEvent` verifies the HMAC over the exact raw bytes and only then parses JSON, so a bad signature can never reach any business logic. A missing signature header short-circuits before the SDK is even called. Both a bad signature and a malformed body are reported as `{ valid: false }` (never thrown), and the route responds `401` without ever calling the processing use case.

## 5. Event handling

`event.account` — Stripe's documented field for identifying the connected account on a Connect-scoped event (confirmed against current Stripe docs, https://docs.stripe.com/connect/webhooks) — is used to resolve the connected account id, with `data.object.id` (the `Account` object itself, for `account.updated` specifically) only as a defense-in-depth fallback. `event.data.object.id` is **not** assumed correct for any other event type. The verifier maps a verified `account.updated` payload onto the exact same field set `StripeConnectGatewayAdapter.retrieveAccountStatus` (Module 71) already produces for polling — `detailsSubmitted`, `transfersActive` (Stripe's `transfers` capability status, not `charges_enabled` — see Module 71's own "post-audit correction"), `payoutsEnabled`, `requirementsCurrentlyDue`, `disabledReason` — so webhook-driven and poll-driven sync can never disagree.

Any other validly-signed event type is acknowledged as `"ignored"` — never a server error, never processed.

## 6. Idempotency strategy

Reuses Module 70.1's `ExternalWebhookEventRepository` unchanged, under provider key `"STRIPE"` (Persona already uses `"PERSONA"` against the same `(provider, externalEventId)`-unique table — no new idempotency system, no new table). `claim()` is called before any business logic; a duplicate delivery (Stripe's own retry, or two concurrent deliveries) returns `claimed: false` and the use case short-circuits to `"duplicate"` with zero side effects. This is DB-unique-constraint-backed (Postgres `23505` on concurrent `INSERT`), not a check-then-insert race — verified by a concurrent-delivery test (`Promise.all` of two `execute()` calls for the same event id → exactly one `"processed"`, one `"duplicate"`).

## 7. account.updated synchronization

`ProcessStripeConnectWebhookUseCase` (`application/use-cases/stripe-connect/process-stripe-connect-webhook.use-case.ts`):

1. Claims the event.
2. If not `account.updated` → `markProcessed` + `"ignored"`.
3. Resolves `ProfessionalOnboardingRepository.findPayoutAccountByStripeAccountId` (added in Module 71 specifically for this). If no match → `markProcessed` + `"unmatched"` — **never** creates a professional or payout account.
4. `deriveStripeExpressReadiness` (Module 71, unchanged) is applied to the mapped payload.
5. **(Post-audit) Atomic write + out-of-order guard, combined**: `ProfessionalOnboardingRepository.updateStripeConnectAccountIfNotStale` performs the write and the ordering check as a single atomic `updateMany` (`WHERE stripeConnectSyncedAt IS NULL OR <= :incoming`) — see §8 for why this replaced the original read-then-write comparison. `applied: false` → `"stale"`, no state change. `applied: true` → `"processed"`. `GetStripeAccountStatusUseCase` (Module 71 polling) is untouched and still calls the original, unconditional `updateStripeConnectAccount`.
6. `markProcessed`.

## 8. Error/failure semantics

| Case | HTTP | Stripe retries? | Notes |
|---|---|---|---|
| Invalid/missing signature | 401 | No (Stripe doesn't retry on 4xx from a signature failure in practice, but this is also never a state Stripe itself produced) | Never processed |
| Unsupported event type | 200 (`"ignored"`) | No | Acknowledged, not an error |
| Unknown Stripe account | 200 (`"unmatched"`) | No | Never creates data |
| Duplicate delivery | 200 (`"duplicate"`) | No | Zero side effects |
| Stale/out-of-order event | 200 (`"stale"`) | No | Acknowledged, not applied |
| Repository/processing failure | 500 | **Yes** | Event marked `FAILED`, re-claimable by Stripe's own retry |

A thrown error inside the use case always results in `markFailed` (never `markProcessed`) before rethrowing — verified by a dedicated test that forces a repository failure, asserts the event is `FAILED`, then successfully re-processes the same event id on a simulated retry.

**(Superseded by post-audit correction — see the addendum at the top of this report.)** The out-of-order guard now compares and writes atomically: `updateStripeConnectAccountIfNotStale` (`domain/repositories/professional-onboarding-repository.ts`, implemented in `PrismaProfessionalOnboardingRepository` via a single `updateMany` with a compound `WHERE`) means there is no longer a read-then-write race window between two concurrent/out-of-order deliveries — see §16 for what this does and does not cover, and `MODULE_72_AUDIT_REPORT.md` for the full concurrency analysis (Scenarios A–D) and the regression tests that prove it.

## 9. Security

- Signature is the **sole** authentication mechanism — no session/cookie dependency (verified by test).
- Never logs: the webhook secret, the raw request body, the `Stripe-Signature` header, or the full parsed Stripe event. Only `requestId`, `outcome`, `event.id`, `event.type`, and the connected Stripe account id are logged.
- Never leaks internals to the client: unexpected errors go through the existing `toHttpErrorResponse` (generic message + request id in production, same as every other route).
- Never persists raw `requirements` arrays, Stripe PII, or the full payload — only the same three booleans + a boolean-from-list Module 71 already persists.
- No new environment variable — reuses the existing, already-validated `STRIPE_WEBHOOK_SECRET`.

## 10. Database impact

**None.** `npx prisma validate`/`generate` could not run in this sandbox (see §12), but inspection of `prisma/schema.prisma` confirms `ExternalWebhookEvent`/`external_webhook_events` (Module 70.1) already has everything this module needs — no migration was written or is required. `ProfessionalPayoutAccount` (Module 71) is untouched.

## 11. Tests

31 tests from the original implementation, plus 13 added by the post-audit correction (44 total for Module 72's own files), all passing:

- `tests/unit/core/infrastructure/payments/stripe-connect-webhook-verifier.test.ts` (10) — signature accept/reject/malformed, no-header short-circuit, secret never leaked, `account.updated` field mapping, `event.account` vs `data.object.id` precedence, non-`account.updated` → `accountUpdated: null`.
- `tests/unit/core/application/use-cases/stripe-connect/process-stripe-connect-webhook.use-case.test.ts` (17, was 12) — READY/PENDING derivation for every combination the brief lists, requirements-boolean mapping, sequential + concurrent idempotency, already-processed safety, unknown-account handling (no creation), unsupported-event ack, out-of-order staleness guard, repository-failure → `FAILED` → successful retry, **plus (post-audit) the concurrency Scenarios A–D, the retry-with-identical-timestamp case, and the §4 `markProcessed`-fails-after-a-successful-write scenario**.
- `tests/unit/app/api/webhooks/stripe-route.test.ts` (9) — HTTP wiring: 401 on bad/missing signature, exact use-case delegation, every outcome → 200, generic 500 shape on unexpected throw, no body/secret leakage, no session dependency.
- `tests/unit/core/infrastructure/database/prisma/repositories/prisma-professional-onboarding-repository.test.ts` (5, was 1 — **post-audit addition**) — proves the actual Prisma `updateMany` call shape for the new atomic guard (`NotFoundError`, the exact `where`/`data` payload, `applied: false` on zero matched rows, `lte` — not `lt` — for retry-safety).

Regression: all pre-existing Module 71 + Persona webhook tests still pass unchanged. Full suite: `npx vitest run` → **504 of 516 test files passed, 12 failed** (4182 of 4200 individual tests passed, 18 failed), and this exact 12-file/18-test failure set is byte-for-byte identical to the pre-existing baseline on `master` — confirmed by running the same command against `master` with this module's files stashed, both before and after the post-audit correction. **This is precise, not an approximation:** all 18 failing tests are `@prisma/client did not initialize yet` (Prisma engine unreachable in this sandbox) or unrelated SEO-metadata/admin-layout failures already present on `master`. Stated correctly: *no new regressions were introduced; the same pre-existing failures remain, both files and count identical to baseline.* This is a module-level pass on every test this module's own code touches, not a repository-wide green build — repository-wide validation remains blocked by the environment limitations in §12/§13.

## 12. Build/typecheck/lint results

- `npx tsc --noEmit`: 105 pre-existing errors both before and after the post-audit correction, **zero** in any Module 72 file or the two files the correction touched (`grep -i stripe` and `grep -i onboarding-repository` on the output both return nothing). Baseline on `master` (before this module existed at all): 108 errors of the identical Prisma-client-generation-caused shape (`Prisma` namespace missing members, implicit `any` from un-generated types) — this module's presence does not increase that count.
- `npx eslint .` (whole repo): **clean, zero errors, zero warnings**, both before and after the post-audit correction (one warning surfaced and was fixed during the correction itself — an unused-variable indexing pattern in the new Prisma repository test — see `MODULE_72_AUDIT_REPORT.md`).
- `npx prisma generate` / `npx prisma validate`: **blocked**, unchanged — `Error: ... 403 Forbidden` fetching `binaries.prisma.sh`. This is the exact same, already-documented sandbox network restriction Module 69/70.1/71's own implementation reports record — not something this module caused or can work around. The post-audit correction adds zero new Prisma models/migrations (it uses Prisma's existing typed `updateMany` against the already-generated-in-principle `professionalPayoutAccount` model), so it does not change the shape or severity of this limitation. **This command could not be run to completion in this environment; its outcome was not observed, only the specific 403 failure, and that failure is not being represented as a pass.**
- `npm run build`: fails at the type-check stage on `src/app/(marketing)/companies/[id]/page.tsx:158` (`Parameter 'category' implicitly has an 'any' type`) — an **unrelated, pre-existing** failure verified to occur identically on `master` before this module's changes, and again identically after the post-audit correction (confirmed via `git stash` + rebuild both times). Root cause is the same un-generated Prisma client. This module's own files (including the two touched by the correction) never appear in the build's error output. **This command was run and observed to fail; the failure point was inspected and attributed, not assumed.**
- `npx vitest run` (full suite): see §11 for the precise, qualified wording.

**Nothing in this report is claimed to have passed without the command actually being executed and its output inspected.**

## 13. Real Stripe Test Mode verification instructions

1. In the Stripe Dashboard (Test mode), or via the CLI, create a webhook endpoint pointing at `https://<your-tunnel-or-deployed-host>/api/webhooks/stripe` with **Events from: "Connected accounts"**, listening for `account.updated`.
2. Local testing with the Stripe CLI (confirmed against current Stripe docs, https://docs.stripe.com/connect/webhooks):
   ```
   stripe listen --forward-connect-to localhost:3000/api/webhooks/stripe
   ```
   This prints a `whsec_...` value — set it as `STRIPE_WEBHOOK_SECRET` locally.
3. In another terminal, trigger a simulated Connect event against a real test-mode connected account:
   ```
   stripe trigger --stripe-account acct_XXXXXXXX account.updated
   ```
4. End-to-end manual flow:
   - Create an Express connected account via the existing `CreateStripeConnectedAccountUseCase` (Module 71) / the professional dashboard flow.
   - Complete (or partially complete) Stripe's hosted onboarding via the link `CreateStripeOnboardingLinkUseCase` generates.
   - Either wait for Stripe's real `account.updated` delivery, or use `stripe trigger --stripe-account <acct_id> account.updated` to force one.
   - Confirm the webhook responds `200` and the server log shows `stripe_connect_webhook_processed` with `outcome: "processed"`.
   - Confirm `ProfessionalPayoutAccount.stripeExpressStatus`/`stripeChargesEnabled`/`stripePayoutsEnabled`/`stripeDetailsSubmitted`/`stripeConnectSyncedAt` updated to match what `GetStripeAccountStatusUseCase`'s own poll would report for the same account (they should always agree — see §7).
   - Re-deliver the same event from the Stripe Dashboard's webhook event log ("Resend") and confirm the log shows `outcome: "duplicate"` and no second state change.

No real Stripe credentials were placed in source code or tests — every test uses a fake/mocked Stripe client or SDK object.

## 14. Files changed

New:
- `src/app/api/webhooks/stripe/route.ts`
- `src/core/application/ports/stripe-connect-webhook-verifier.ts`
- `src/core/application/use-cases/stripe-connect/process-stripe-connect-webhook.use-case.ts`
- `src/core/infrastructure/payments/stripe/stripe-connect-webhook-verifier.ts`
- `tests/unit/app/api/webhooks/stripe-route.test.ts`
- `tests/unit/core/application/use-cases/stripe-connect/process-stripe-connect-webhook.use-case.test.ts`
- `tests/unit/core/infrastructure/payments/stripe-connect-webhook-verifier.test.ts`

Modified (additive only — nothing removed or behaviorally changed for existing callers):
- `src/core/application/use-cases/stripe-connect/compose.ts` — added `webhookEvents` repo instance, `makeProcessStripeConnectWebhookUseCase()`, `getStripeConnectWebhookVerifierInstance()`.
- `src/core/infrastructure/payments/stripe/compose.ts` — added `stripeConnectWebhookVerifier`/`makeStripeConnectWebhookVerifier()`.
- `tests/unit/core/application/use-cases/stripe-connect/fakes.ts` — added `FakeExternalWebhookEventRepository` (Module 71's own test fakes file, extended in place).

**Post-audit correction (see `MODULE_72_AUDIT_REPORT.md`):**
- `src/core/domain/repositories/professional-onboarding-repository.ts` — added `updateStripeConnectAccountIfNotStale` to `ProfessionalOnboardingRepository` (additive; `updateStripeConnectAccount` itself untouched, still used unchanged by Module 71's `GetStripeAccountStatusUseCase`).
- `src/core/infrastructure/database/prisma/repositories/prisma-professional-onboarding-repository.ts` — implemented the new method via a single atomic `updateMany`; no schema change.
- `src/core/application/use-cases/stripe-connect/process-stripe-connect-webhook.use-case.ts` — replaced the read-then-write out-of-order check with a call to the new atomic method.
- `tests/unit/core/application/use-cases/onboarding/fakes.ts` — added the matching fake method (`FakeProfessionalOnboardingRepository`, shared with Module 71's own tests, extended in place).
- `tests/unit/core/application/use-cases/stripe-connect/process-stripe-connect-webhook.use-case.test.ts` — added the audit's concurrency (Scenarios A–D) and `markProcessed`-failure regression tests.
- `tests/unit/core/infrastructure/database/prisma/repositories/prisma-professional-onboarding-repository.test.ts` — added direct unit tests proving the actual Prisma `updateMany` call shape.

No file belonging to another module was modified. No business rule, commission calculation, or financial logic was touched.

## 15. Out of scope (per the module brief — none of this was implemented)

Customer payment creation, PaymentIntent execution, Stripe Transfer execution/reversal, refunds, disputes, VAT/tax calculation, invoices, commission calculation, payout scheduling, payment-release logic, Trust & Integrity logic, and `account.application.deauthorized`.

## 16. Remaining risks

1. **(Resolved by post-audit correction)** The out-of-order guard is now a single atomic `updateMany` (`updateStripeConnectAccountIfNotStale`) — the read-then-write race the original implementation disclosed no longer exists. What remains, and is *not* fixable without touching Module 70.1 (explicitly preserved as-is per the audit's instructions): if `updateStripeConnectAccountIfNotStale` succeeds but the subsequent `ExternalWebhookEventRepository.markProcessed` call itself fails, the use case's `catch` marks the event `FAILED` and rethrows (Stripe retries) — this is safe (the retry re-applies the identical, already-correct state, accepted by the `<=` guard; proven by a dedicated regression test). The one genuinely open edge case, shared identically with Persona's `ProcessPersonaWebhookUseCase` and not introduced by this module, is if `markFailed` *itself* also throws (e.g. total DB outage) — the event is left `PROCESSING` forever and becomes permanently unreclaimable by any future retry. Fixing this would mean changing `ExternalWebhookEventRepository`'s own claim/retry contract (Module 70.1), which both this module's brief and the audit explicitly required be preserved unmodified; see `MODULE_72_AUDIT_REPORT.md` §4 for the full analysis.
2. **Prisma client/engine could not be generated or validated in this sandbox** (`binaries.prisma.sh` returns 403) — `npx prisma generate`, `npx prisma validate`, and `npm run build` could not be fully verified end-to-end here. The existing `PrismaExternalWebhookEventRepository` (Module 70.1, reused unchanged) already works around this via raw SQL for exactly this reason; this module adds no new Prisma model (`updateStripeConnectAccountIfNotStale` uses Prisma's typed `updateMany`, not raw SQL), so the blast radius of this limitation is unchanged from before this module.
3. **Stripe test-mode delivery itself was not exercised** in this sandbox (no outbound Stripe webhook could reach this environment, and no live Stripe test account was available) — §13 gives the exact manual verification steps for a real environment; that verification has not been performed by this implementation and should be run before this module is considered production-verified end to end.

## 17. Module 73 integration points

- `ProcessStripeConnectWebhookUseCase`'s `"processed"`/`"stale"` outcomes both carry `professionalProfileId` — a future payment-release module can react to `stripeExpressStatus` transitioning to `READY` without re-deriving it.
- `account.application.deauthorized` was investigated against current Stripe documentation (https://docs.stripe.com/connect/webhooks) and deliberately **not implemented**: Stripe's own event table describes it as "Available for connected accounts with access to the Stripe Dashboard, which includes Standard accounts" — the OAuth-style "connected account disconnects from your platform" flow this event models is a Standard-account concept (Standard accounts have their own full Stripe Dashboard login and can independently revoke a platform's API access). MaestroYa's Express accounts under this module's own Connect model do not go through that OAuth deauthorization flow. If a future module needs to detect a professional's connected account becoming permanently unusable, the more directly-applicable signal already flowing through this module is `account.updated`'s own `requirements.disabled_reason` (already captured in `StripeConnectAccountUpdatedPayload.disabledReason`, currently diagnostic-only) — Module 73 (or later) can decide whether to act on it.
- `StripeConnectWebhookVerifier`/`StripeConnectWebhookEvent` were deliberately kept generic enough (`type: string`, a nullable typed payload per event) that adding a second Connect event type later (e.g. `account.external_account.updated`, `person.updated`) is a new field on `StripeConnectWebhookEvent` plus a new branch in `ProcessStripeConnectWebhookUseCase`, not a port/route redesign.
