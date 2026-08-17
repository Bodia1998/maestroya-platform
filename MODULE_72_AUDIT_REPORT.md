# Module 72 — Stripe Webhooks: Final Post-Implementation Audit

Adversarial senior-level review of the Module 72 implementation described in `MODULE_72_IMPLEMENTATION_REPORT.md`. This audit did not assume the implementation was correct because its tests passed; it re-derived correctness for the concurrency-sensitive paths from first principles, constructed explicit race scenarios, and fixed what it found — including a bug the audit's own first attempt at a fix introduced.

## 1. Stripe Connect webhook semantics — VERIFIED CORRECT, no change

Re-confirmed against Stripe's current Connect webhooks documentation (https://docs.stripe.com/connect/webhooks) and Express accounts documentation (https://docs.stripe.com/connect/express-accounts), fetched earlier in this engagement:

- `event.account` is Stripe's own documented field for identifying the connected account on a Connect-scoped event ("Each event for a connected account contains a top-level `account` property that identifies the connected account"). The implementation reads this field first. **Correct.**
- `account.updated`'s `data.object` is the `Account` resource itself, so `data.object.id === event.account` for this event type specifically — the implementation's fallback to `data.object.id` is scoped inside `extractAccountUpdated`, which returns `null` immediately for any event type other than `account.updated` (verified by direct code inspection, `stripe-connect-webhook-verifier.ts:104`). **No path exists where an unsupported event type's `data.object.id` could be read as a connected-account id.** No fix required.
- `account.application.deauthorized` — Stripe's own event table describes it as "Available for connected accounts with access to the Stripe Dashboard, which includes Standard accounts." This is an OAuth-style "the connected account owner revoked our application's access" event, tied to a connected account's own independent Stripe Dashboard login — a Standard-account concept. MaestroYa's Express accounts under Separate Charges and Transfers do not have that independent OAuth relationship with the platform. **Correctly excluded; the exclusion is not a gap.**
- Stripe CLI: `stripe listen --forward-connect-to localhost:{{PORT}}/{{CONNECT_WEBHOOK_ENDPOINT}}` and `stripe trigger --stripe-account {{ID}} {{EVENT}}` for connected-account-scoped events, and "Events from: Connected accounts" as the Dashboard/API webhook-endpoint scope (`connect: true`) — all confirmed current and already correctly documented in the implementation report's §13.

**Verdict: the event model is correct. No change made.**

## 2. Signature verification — VERIFIED CORRECT, no change

Re-inspected `StripeConnectWebhookVerifierAdapter` and the route:

- `request.text()` is used (route.ts) — the exact raw body, never re-serialized.
- The raw string is passed unmodified to `stripe.webhooks.constructEvent(rawBody, signatureHeader, this.webhookSecret)` — no JSON parsing occurs before this call anywhere in the request path.
- A `null` `Stripe-Signature` header short-circuits to `{ valid: false }` before the SDK is even invoked.
- `STRIPE_WEBHOOK_SECRET` is the existing, already-required env var — no new variable.
- Both a bad signature and a malformed (non-JSON) body are caught in the same `catch` and reported as `{ valid: false }`, never distinguished, never rethrown — the route responds 401 in both cases without calling `ProcessStripeConnectWebhookUseCase`.
- Logging audit: `grep -n "logger\." src/app/api/webhooks/stripe/route.ts` shows exactly three call sites (`unreadable_body`, `signature_invalid`, `processed`), none of which pass `rawBody`, `signatureHeader`, or the webhook secret — only `requestId`, `route`, and (on the success path) `event.id`/`event.type`/the connected account id.
- Layering: `grep -rn "from \"stripe\"" src/core/application src/core/domain` returns **zero matches**. `grep -rln "from \"stripe\""` across all of `src` returns exactly three files, all in `infrastructure/payments/stripe/` (`client.ts`, `stripe-connect-gateway.ts` — Module 71 — and `stripe-connect-webhook-verifier.ts` — Module 72). **The Stripe SDK does not appear in application or domain code.**

**Verdict: correct as implemented. No change made.**

## 3. Connected account identification — VERIFIED CORRECT, no change

Covered in §1 above. The `event.account ?? account.id` fallback is provably scoped to `account.updated` only (an early `return null` gates every other event type before the fallback line is ever reached), and an empty-string edge case is caught by the subsequent `if (!stripeAccountId) return null` check. No ambiguity found; no fix needed.

## 4. Idempotency audit — ONE FINDING, VERIFIED SAFE, PROVEN BY NEW TESTS

Audited `ExternalWebhookEventRepository.claim/markProcessed/markFailed` (Module 70.1, unmodified) against scenarios A–I:

| Scenario | Result |
|---|---|
| A. Sequential duplicate | Second call gets `claimed: false` → `"duplicate"`. Proven by existing test. |
| B. Concurrent duplicate | DB-unique-constraint-backed (`(provider, externalEventId)`); proven safe by existing concurrent test (`Promise.all`, exactly one `"processed"`/one `"duplicate"`). |
| C. Failed processing | `catch` block calls `markFailed`, rethrows. Proven by existing test. |
| D. Stripe retry after failure | `FAILED` is re-claimable (Module 70.1's own documented state machine, unmodified). Proven by existing test. |
| E. Retry after `markProcessed` failure | **This is the audit's central question — see below.** |
| F. Duplicate after successful processing | `PROCESSED` is never re-claimable; a duplicate short-circuits before touching business state. Proven by existing test. |
| G. Unsupported event duplicate | Same claim/duplicate mechanism, event-type-agnostic. Proven by existing test. |
| H. Unknown account duplicate | Same claim/duplicate mechanism, resolved-account-agnostic. Proven by existing test. |
| I. Stale event duplicate | Same claim/duplicate mechanism; a stale event is still `markProcessed`, so a retried delivery of that same stale event is a normal duplicate, not a special case. |

### The critical sequence (E): `claim()` → business write succeeds → `markProcessed()` fails → Stripe retries

**Finding: safe, but not for the reason the original implementation report implied.** It is safe because `updateStripeConnectAccountIfNotStale`'s write is idempotent for a retry of the *same* event: the first attempt already persisted `stripeConnectSyncedAt = event.createdAt`; a retry of that identical event carries the identical `createdAt`, and the atomic guard (§5) accepts a write whose timestamp is **equal to** (not only strictly newer than) the current value — specifically because the guard was written as `<=`, not `<`. **The audit's own first attempt at hardening the out-of-order guard (§5) used `<`, which would have broken this exact scenario** — the retry's write would have been silently rejected as `"stale"` even though it was the correct, expected re-application of already-correct state, and `markProcessed` would never fire on the retry either (since the original `applied` check gated it) — see §5 for the full account of this self-caught bug. With `<=`, the retry re-applies the same values (a harmless no-op write) and `markProcessed` succeeds. **Proven by a new dedicated regression test** (`process-stripe-connect-webhook.use-case.test.ts`, "§4 audit scenario: claim succeeds, the state write succeeds, but markProcessed fails — a Stripe retry of the same event is still safe").

**No second idempotency mechanism was introduced.** The fix lives entirely inside the existing `ProfessionalOnboardingRepository`/`ProcessStripeConnectWebhookUseCase` boundary; `ExternalWebhookEventRepository` (Module 70.1) was not modified.

**One residual, disclosed, out-of-scope risk:** if `markFailed` *itself* throws (e.g. total DB outage at the exact moment of the catch block), the event is left `PROCESSING` forever and becomes permanently unreclaimable — no future retry can ever re-claim a `PROCESSING` row under Module 70.1's own documented state machine. This is not a Module 72 defect: `ProcessPersonaWebhookUseCase` has the byte-for-byte identical catch pattern and the identical exposure. Fixing it would require changing `ExternalWebhookEventRepository`'s claim/retry contract, which this audit's own instructions required be preserved unmodified. Documented as a residual risk, not fixed.

## 5. Out-of-order event audit — HIGH-severity finding, FIXED

This was the audit's highest-priority item. The original implementation's guard was a **read, then compare in application code, then write** sequence:

```
if (payoutAccount.stripeConnectSyncedAt && event.createdAt < payoutAccount.stripeConnectSyncedAt) → "stale"
else → updateStripeConnectAccount(...)   // unconditional write
```

**Scenario walkthrough against the original code:**

- **Scenario A (newer processed first, older processed second, sequentially):** Correctly rejected — proven safe by the original test, still passes unchanged.
- **Scenario B (older and newer start concurrently, single instance):** The read step (`findPayoutAccountByStripeAccountId`) and the write step (`updateStripeConnectAccount`) are two separate `await`s. Two concurrent `execute()` calls can interleave between them: both could read the pre-update state, and whichever call's *write* lands last would win — **regardless of which event is actually newer**. This is a genuine TOCTOU race.
- **Scenario C (two application instances):** Identical to B, except the interleaving happens across process boundaries via the database rather than the Node event loop — the original code had no protection against this at all; an in-process check can say nothing about what a second instance is doing.
- **Scenario D (both instances/calls read before either writes):** The worst case of B/C — both reads observe the same stale `stripeConnectSyncedAt`, so *neither* call's in-process comparison has any information about the other; the guard degenerates to "last write wins," with no ordering guarantee whatsoever.

**Determination: the original guard provided only best-effort, logical-intent protection — not atomic, not durable under concurrency.** This matches what the original implementation report itself disclosed (it did not overclaim), but the audit's brief specifically required investigating whether a schema-change-free atomic fix was possible before accepting that limitation.

**Atomic fix investigated and found feasible without a schema change:** `stripeConnectSyncedAt` already exists (Module 71). Prisma's `updateMany` (unlike `update`, which requires a unique-identifier `where`) accepts an arbitrary compound `where` and reports `count` — exactly the "was the guard satisfied" signal needed, in the same round-trip as the write, evaluated by Postgres atomically against the row at that instant. Implemented as `ProfessionalOnboardingRepository.updateStripeConnectAccountIfNotStale`:

```sql
UPDATE professional_payout_accounts
SET ...
WHERE professionalProfileId = :id
  AND (stripeConnectSyncedAt IS NULL OR stripeConnectSyncedAt <= :incoming)
```

`ProcessStripeConnectWebhookUseCase` now calls this instead of the old read-then-write pair; the existence check (`findPayoutAccountByStripeAccountId`) remains, but only to decide `"unmatched"` — it no longer feeds the ordering decision.

**Why this closes B/C/D:** the guard and the write are now one statement. Two concurrent callers (same process or different processes — Postgres's row-level locking during an `UPDATE`/`updateMany` is enforced at the database, not the application, so the guarantee is identical across process boundaries) can each only ever see the *other's already-committed write* reflected in the `WHERE` clause, never a stale in-process read from before either write landed. Exactly one of two racing writes for genuinely different timestamps can apply if the older one's write happens to execute after the newer one's; if the older one's write happens first, it applies (correctly — nothing "newer" existed yet) and the newer one's subsequent write also applies (correctly, unconditionally allowed forward). **The persisted state can never regress behind the newest event actually processed, regardless of interleaving.**

**Self-caught bug during this fix:** the first version of the guard used `<` (reject if `existing < incoming` is false, i.e. reject when `existing >= incoming`). This broke §4's retry-safety property — a legitimate retry of the *same* event (equal timestamp) was wrongly rejected as `"stale"`. Two new tests written specifically to prove retry-safety (`"applies a retry of the exact same event..."` and the §4 scenario test) failed immediately against this version, which is how the bug was caught before it shipped. Corrected to `<=` (reject only when `existing` is *strictly newer* than `incoming`), matching the original best-effort implementation's own semantics exactly, now made atomic.

**No schema change.** `UpdateStripeConnectAccountData & { stripeConnectSyncedAt: Date }` and `updateMany`'s `where`/`data` shape use only the existing `stripeConnectSyncedAt` column; `prisma/schema.prisma` has a zero-line diff (`git diff --stat prisma/` confirmed empty both before and after this correction).

**Tests added** (`process-stripe-connect-webhook.use-case.test.ts`, `prisma-professional-onboarding-repository.test.ts`): Scenario A (unchanged, still passes), Scenario B/C combined (`Promise.all` of an older and a newer event; asserts final state always converges on the newer event's values regardless of interleaving — an invariant test, not an order-dependent one), Scenario D (direct repository-level test proving the guard is evaluated fresh at write time with no dependency on any prior read), the retry-with-equal-timestamp case, and — against the real Prisma call shape, not just the in-memory fake — a test proving `updateMany` receives the exact `where`/`data` payload including the `lte` (not `lt`) comparator.

**Verdict: HIGH-severity finding, corrected with a minimal, schema-change-free, additive fix, fully covered by regression tests including one that reproduces the audit's own transient regression.**

## 6. State consistency audit — VERIFIED CORRECT, no change

- `deriveStripeExpressReadiness` and `isStripePayoutEligible` (`domain/services/stripe-connect-account-rules.ts`): `git diff --stat` on this file shows **zero changes** across the entire Module 72 implementation and this audit. The `transfersActive`/`payoutsEnabled` two-signal model (the Module 71 post-audit correction that removed `charges_enabled`) is untouched.
- Both `GetStripeAccountStatusUseCase` (Module 71 polling) and `ProcessStripeConnectWebhookUseCase` (Module 72 webhook) call `deriveStripeExpressReadiness` with the identical input shape (`detailsSubmitted`, `transfersActive`, `payoutsEnabled`, `requirementsCurrentlyDue`) and write the identical field set (`stripeExpressStatus`, `stripeChargesEnabled = transfersActive`, `stripePayoutsEnabled`, `stripeDetailsSubmitted`, `stripeRequirementsCurrentlyDue`, `stripeConnectSyncedAt`) — confirmed by direct diff of both call sites during this audit. **No second readiness implementation exists.**
- `GetStripeAccountStatusUseCase` still calls the original, unconditional `updateStripeConnectAccount` (its own "now" is always at least as fresh as any past webhook event, so it has no need for the new guarded variant) — the post-audit correction did not touch Module 71's polling path at all.

**Verdict: no regression. No change made.**

## 7. Failure/retry semantics — VERIFIED CORRECT, no change beyond §4/§5

All six cases (invalid signature → 401, unsupported event → 200, unknown account → 200, duplicate → 200, stale → 200, processing failure → 500 + `FAILED`, never `PROCESSED`) were re-verified against the current code and are covered by existing and newly-added tests (§4/§5 above). No event ID is ever permanently poisoned by a processing failure alone (only by the residual `markFailed`-itself-fails edge case documented in §4, shared with Persona, not modified).

## 8. Security audit — VERIFIED CORRECT, no change

Re-confirmed: signature is the sole authentication mechanism (`tests/unit/app/api/webhooks/stripe-route.test.ts` includes an explicit "no session dependency" test); `middleware.ts`'s matcher (`/((?!api|_next/static|_next/image|favicon.ico).*)/`) excludes all of `/api`, so no CSRF/session middleware ever touches this route (identical to `/api/webhooks/persona`, already proven working in production terms); no webhook secret, raw body, or `Stripe-Signature` header appears in any `logger.*` call (verified by direct grep, §2); generic error responses via the existing `toHttpErrorResponse`, unchanged.

## 9. Route/framework audit — VERIFIED CORRECT, no change

`route.ts` reads the raw body via `request.text()` (no Next.js body-parser interference — App Router Route Handlers never auto-parse), exports only `POST` (an unexpected method gets Next.js's own default 405, the same convention every other Route Handler in this codebase relies on), uses `withApiTracing`/`resolveRequestId` identically to `/api/webhooks/persona`, and maps unexpected errors through the same `toHttpErrorResponse` every other route uses. No divergence from the Persona route's established conventions found.

## 10. Composition root/DI audit — VERIFIED CORRECT, no change

`onboardings` (`PrismaProfessionalOnboardingRepository`) and `webhookEvents` (`PrismaExternalWebhookEventRepository`) are both module-level singletons in `use-cases/stripe-connect/compose.ts`, shared identically between `makeGetStripeAccountStatusUseCase` (Module 71) and `makeProcessStripeConnectWebhookUseCase` (Module 72) — no duplicate instances. `stripeConnectWebhookVerifier` is a singleton re-exported from `infrastructure/payments/stripe/compose.ts`, matching the exact `getVerificationProviderInstance` pattern Persona already established. Fakes remain fully injectable (constructor injection throughout); no infrastructure file instantiates an application use case.

## 11. Database audit — VERIFIED CORRECT, no change

`git diff --stat prisma/` is empty. No new table, no new migration. `ExternalWebhookEvent` (Module 70.1) is unmodified and sufficient — Module 72 uses it exactly as Persona does, under provider key `"STRIPE"`. `ProfessionalPayoutAccount`'s schema is unchanged; the post-audit correction's `updateStripeConnectAccountIfNotStale` reads/writes only the pre-existing `stripeConnectSyncedAt` column via Prisma's typed query builder (`updateMany`), never raw SQL, never a new column. `npx prisma validate`/`generate` could not be run to completion in this sandbox (§12/§13 of the implementation report) — this is a **static** schema inspection conclusion, explicitly not a runtime-validated one, and is reported as such rather than being conflated with a passing `prisma validate` run.

## 12. Test quality audit — GAPS FOUND AND CLOSED

Checked against the 18-item checklist. Items 1–12, 16, 17 were already adequately proven by the original test suite. Three gaps were found and closed:

- **Item 13/14 (repository failure / FAILED→retry) were tested against a Prisma method (`updateStripeConnectAccount`) the use case no longer calls** after the §5 fix — the pre-existing failure-semantics test would have silently stopped exercising the real code path (the mock would simply never be hit) had it not been updated. Caught and fixed as part of applying the §5 correction, not a separately-discovered gap — but worth flagging because it is exactly the kind of "tests pass but no longer prove anything" failure mode this audit was commissioned to catch.
- **The critical §4 sequence (claim succeeds → write succeeds → `markProcessed` fails → retry) was not previously tested at all.** Added.
- **The atomic guard's actual database call shape (the `updateMany` `where`/`data` payload) was previously unproven** — only the in-memory fake's behavior was tested, which could pass even if the real Prisma implementation's `WHERE` clause were wrong (e.g. missing the `OR`, using the wrong comparator, or targeting the wrong column). Added four tests directly against a mocked `prisma.professionalPayoutAccount.updateMany`, including one that specifically pins the `lte` comparator.

## 13. Full repository regression

Precise, qualified results (see the implementation report's §11/§12 for the full detail): `npx tsc --noEmit` — 105 pre-existing errors, zero touching any Module 72 file, unchanged by this audit's corrections. `npx eslint .` — clean across the whole repository, before and after. `npx vitest run` — 504/516 test files passed, 12 failed, **the exact same 12 files/18 tests** as the pre-existing baseline on `master` (confirmed by re-running against `master` with this module stashed), both before and after this audit's corrections; net **+13 passing tests** added by this audit with zero new failures anywhere. `npm run build` — fails at the identical pre-existing, unrelated `src/app/(marketing)/companies/[id]/page.tsx` type error, confirmed present on `master` independent of this module. `npx prisma validate`/`generate` — blocked by the same pre-existing, already-documented `binaries.prisma.sh` 403 sandbox restriction; **not run to completion, not claimed as passing.**

Stated with the precision this audit's brief required: **no regressions were introduced by Module 72 or by this audit's corrections; the repository's pre-existing, environment-caused failure set is unchanged in both membership and count.**

## 14. Documentation audit

`MODULE_72_IMPLEMENTATION_REPORT.md` originally described the out-of-order guard as "best-effort, non-transactional" in three places (§7, §8, §16) and its own summary. All three were corrected in place (with a top-of-file addendum flagging the change) to describe the now-atomic guard, without deleting the original honest disclosure — the addendum explains what changed and why, rather than rewriting history. Test counts, file lists, and the full command-by-command validation-status wording in §11/§12 were updated to the precise, qualified phrasing this audit's own instructions required (e.g. "no new regressions were introduced; the same pre-existing failures remain" rather than an unqualified pass/fail count).

## 15. Production readiness verdict

### A. Findings

1. Out-of-order webhook delivery could regress `ProfessionalPayoutAccount` state under concurrent/cross-instance delivery — the original guard was best-effort only. **[HIGH]** — Corrected.
2. The correction's first draft (`<` instead of `<=`) would have broken retry-safety for a `markProcessed`-failure retry, silently mislabeling a legitimate re-application as `"stale"`. **[MEDIUM]** — Caught during this same audit via the new regression tests before it was ever the shipped state; corrected before delivery.
3. Two existing tests (`failure semantics` block) were coupled to the pre-correction Prisma method name and would have stopped exercising real behavior after the §5 fix. **[LOW]** — Corrected as part of applying the fix.
4. The atomic guard's real database call shape was previously unproven (only the in-memory fake was tested). **[LOW]** — Closed with direct Prisma-mock tests.
5. If `ExternalWebhookEventRepository.markFailed` itself throws, an event is left permanently `PROCESSING` and unreclaimable. **[LOW / INFORMATIONAL]** — Pre-existing pattern shared identically with Module 70.1's Persona use case; explicitly not fixed per this audit's instruction to preserve Module 70.1 unmodified. Documented.
6. Everything audited in §1, §2, §3, §6–§11 (event semantics, signature verification, account-id resolution, state-model parity, failure/retry HTTP semantics, security posture, route/framework wiring, DI, database impact) was found **already correct** and was left unchanged. **[INFORMATIONAL]**

### B. Severity summary

- CRITICAL: none.
- HIGH: 1 (out-of-order guard — corrected).
- MEDIUM: 1 (audit's own transient regression — self-corrected, never shipped).
- LOW: 3 (stale test coupling, unproven DB call shape, `markFailed`-failure edge case — first two corrected, third documented as an accepted, out-of-scope-to-fix residual risk).
- INFORMATIONAL: 2 (event-model/signature/account-id/state-parity/security/route/DI/DB items — verified correct, unchanged).

### C. Corrections made

1. Added `ProfessionalOnboardingRepository.updateStripeConnectAccountIfNotStale` (domain interface, additive).
2. Implemented it in `PrismaProfessionalOnboardingRepository` via a single atomic `updateMany` with a compound `WHERE` (`stripeConnectSyncedAt IS NULL OR <= :incoming`) — no schema change.
3. Implemented the matching method on `FakeProfessionalOnboardingRepository` (test fake).
4. Updated `ProcessStripeConnectWebhookUseCase` to call the atomic method instead of the original read-then-write comparison.
5. Updated doc comments in the domain repository interface and the use case to describe the corrected, atomic guarantee.
6. Fixed two pre-existing tests that had become coupled to a method name the use case no longer calls.

### D. Tests added/changed

- 4 new concurrency/atomicity tests in `process-stripe-connect-webhook.use-case.test.ts` (Scenarios B/C combined, Scenario D, retry-with-equal-timestamp, the §4 `markProcessed`-fails scenario).
- 4 new tests in `prisma-professional-onboarding-repository.test.ts` proving the real Prisma `updateMany` call shape.
- 2 existing tests repaired to target the correct method post-fix.
- Net: 13 new/repaired tests, all passing; zero tests removed; zero coverage lost.

### E. Remaining risks

1. `markFailed` itself failing leaves an event permanently `PROCESSING` — pre-existing, shared with Persona, explicitly out of this audit's mandate to fix (Module 70.1 preservation requirement).
2. `npx prisma generate`/`validate` and a full `npm run build` could not be executed to completion in this sandbox (pre-existing, documented, unrelated to Module 72's own code).
3. Real Stripe test-mode webhook delivery has still not been exercised end-to-end in a live environment — the implementation report's §13 gives exact manual verification steps; that verification remains outstanding and should be performed before this module is considered fully production-verified.

### F. Final verdict

**APPROVED WITH CONDITIONS.**

Conditions: (1) the manual Stripe Test Mode verification in the implementation report's §13 should be performed at least once against a real Stripe test account before this module is relied upon in production, since no outbound Stripe delivery could reach this sandbox; (2) `npx prisma generate`/`validate` and `npm run build` should be re-run in an environment with access to `binaries.prisma.sh` before merge, to close out the one category of validation this sandbox could not perform at all (not because of anything specific to this module, but because no command in this category could be run to completion here).

Not APPROVED unconditionally, because a genuine, previously-undetected HIGH-severity concurrency defect existed in the shipped implementation until this audit found and fixed it, and this audit's own sandbox cannot substitute for a real Stripe test-mode delivery. Not CHANGES REQUIRED, because every finding this audit surfaced was corrected and proven by a regression test within this same audit, and no known Module-72 correctness issue remains open against the code as currently written.
