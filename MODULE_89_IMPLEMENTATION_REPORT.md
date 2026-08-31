# Module 89 — Fraud & Trust Signal Activation — Implementation Report

## Status

**COMPLETE WITH CONDITIONS.** Two real, previously-dormant Module 65 enforcement
gaps — explicitly named in Module 65's own code comments and doc — were
activated with minimal, additive, backward-compatible changes. No new fraud
engine, no new scoring, no schema changes. See "Conditions" under the Final
Verdict for what remains before this can be called fully closed, and
"Out-of-scope findings" for what Modules 88/90/87 should pick up.

## Module 65 audit (Phase 0)

Module 65 ("Trust & Integrity System") is fully built and already
comprehensive: `TrustProfile`/`ScoreEvent` (Trust Score + Risk Score, both
0-100, append-only), ten pure rule-engine detectors under
`src/core/domain/services/` (off-platform, fraud, fake-review, spam,
suspicious-pricing, booking-abuse, payment-abuse, identity-risk, plus two
Module 67 completion-risk detectors), a `TrustAutomatedAction` ledger
(`WARNING` → `PERMANENT_SUSPENSION`, 8 types), a manual-review queue, and an
appeal workflow that reverses actions and restores trust. Everything is wired
through the shared `EventBus` and one `docs/MODULE_65_TRUST_AND_INTEGRITY_SYSTEM.md`
audit trail. No AI/LLM anywhere — every detector is a named, reviewable rule
function operating on caller-supplied data only.

**What was already active before this module** (confirmed by tracing real
call sites, not assumed):
- `PAYOUT_HOLD` enforcement — already checked via
  `TrustAutomatedActionRepository.listActiveForUser(userId, "PAYOUT_HOLD")`
  in `ExecuteProfessionalPayoutUseCase`, `CheckPayoutReadinessUseCase`,
  `EvaluatePaymentReleaseUseCase`, and `AdminResolvePaymentReleaseUseCase`.
- `DetectPrematureJobCompletionUseCase` and
  `DetectJobCompletionDisputeConflictUseCase` (Module 67) — already
  subscribed to `ProfessionalCompletedJob`/`DisputeCreated` on the shared
  `eventBus` in `trust-integrity/compose.ts`.
- `PAYMENT_ABUSE_DETECTED` always additionally applies a defensive
  `PAYOUT_HOLD` regardless of tier, inside `ApplyAutomatedActionUseCase`.

**What was confirmed disconnected** (grepped every caller of every
`Detect*UseCase` and `TrustAutomatedActionRepository.listActiveForUser`
across `src/`):
- `DetectOffPlatformCommunicationUseCase`, `DetectFraudSignalsUseCase`,
  `DetectFakeReviewPatternsUseCase`, `DetectSpamActivityUseCase`,
  `DetectSuspiciousPricingUseCase`, `DetectBookingAbuseUseCase`,
  `DetectPaymentAbuseUseCase`, `DetectIdentityRiskUseCase` — every one of
  these was called only from `trust-integrity/compose.ts` and each other
  (tests aside). None had a real production call site.
- `BOOKING_RESTRICTION` and `MESSAGING_RESTRICTION` — the two
  `TrustAutomatedActionType`s that exist on the ledger and are enforceable
  via `listActiveForUser`, but (per that method's own doc comment: "any
  future booking/messaging enforcement check") were never consulted
  anywhere. A user with an active `BOOKING_RESTRICTION` or
  `MESSAGING_RESTRICTION` could still book and message freely.
- `User.status` suspension enforcement — still a documented limitation
  (`UserRepository` has no `updateStatus` method); unchanged by this
  module, see "Out-of-scope findings."
- `TrustAutomatedActionRepository.expireDue` — still nothing schedules it;
  unchanged by this module, see "Out-of-scope findings."

## Fraud/trust decision matrix (Phase 1 — signals that actually exist)

| Signal / ledger type | Where enforced (before) | Where enforced (after Module 89) | Action |
| --- | --- | --- | --- |
| `PAYOUT_HOLD` | Payout execution/eligibility/release (4 call sites) | unchanged | BLOCK payout |
| `PAYMENT_ABUSE_DETECTED` → `PAYOUT_HOLD` | `ApplyAutomatedActionUseCase` (always) | unchanged | BLOCK payout |
| `BOOKING_RESTRICTION` | nowhere | `AcceptQuoteUseCase` (both customer and professional side) | BLOCK booking creation |
| `MESSAGING_RESTRICTION` | nowhere | `SendMessageUseCase` (sender) | BLOCK message send |
| Off-platform contact in a chat message | detector existed, never called | `SendMessageUseCase` (best-effort, post-send) | MONITOR / feeds Risk Score on high confidence |
| `ProfessionalCompletedJob` → premature completion | Module 67 event subscriber | unchanged | MONITOR → feeds Risk Score |
| `ProfessionalCompletedJob`/`DisputeCreated` → completion/dispute conflict | Module 67 event subscribers | unchanged | REQUIRE_ADMIN_REVIEW (opens `ManualReviewCase`) |

Booking abuse, fake-review, spam, suspicious-pricing, payment-abuse, and
identity-risk detectors remain **built but not wired to a real call site** —
see "Out-of-scope findings." They were deliberately *not* activated in this
pass; each needs aggregated/statistical caller-supplied input (cancellation
history, pricing baselines, review timing patterns) that the single-request
use cases touched here don't naturally have on hand, and wiring them
correctly needs its own scoped pass rather than being bolted on as a side
effect of this one.

## Activated enforcement paths (Phase 2)

### 1. `BOOKING_RESTRICTION` in `AcceptQuoteUseCase`
`src/core/application/use-cases/quotes/accept-quote.use-case.ts` is the
single place a Job/Appointment (i.e. a "booking") is created from an
accepted Quote. Immediately before the atomic `quoteAcceptance.acceptQuote(...)`
write — never earlier, never cached — the use case now checks
`listActiveForUser(customerUserId, "BOOKING_RESTRICTION")` and, if the
professional repository is available, `listActiveForUser(professionalUserId, "BOOKING_RESTRICTION")`.
Either an active restriction on the customer or on the professional blocks
acceptance with a `ValidationError`; no partial state is written. New
constructor parameter (`trustAutomatedActions?: TrustAutomatedActionRepository`)
is optional and defaults to skipping the check entirely, so every
pre-existing construction of the class (including this codebase's own
tests) keeps compiling and behaving exactly as before. Production's
`quotes/compose.ts` now always supplies it.

### 2. `MESSAGING_RESTRICTION` + off-platform detection in `SendMessageUseCase`
`src/core/application/use-cases/chat/send-message.use-case.ts`'s own doc
comment explicitly named this "the single seam a future policy layer would
wrap around" — this is that seam. Before persisting a message, an active
`MESSAGING_RESTRICTION` on the sender blocks the send with a
`ValidationError` (no message row is ever written). After persisting, the
message body is handed best-effort to
`DetectOffPlatformCommunicationUseCase` (Module 65's existing rule engine) —
identical in spirit to the existing best-effort notification hook a few
lines below it: a detection failure is logged and never undoes or fails
message delivery. Two new optional constructor parameters
(`trustAutomatedActions?`, `offPlatformDetection?`), both defaulting to
skip, same backward-compatibility guarantee as above. `chat/compose.ts`
constructs its own fresh Prisma repositories for both (never importing a
`make*UseCase` from `trust-integrity/compose.ts`) — this mirrors the exact
"each compose.ts constructs its own cross-module dependencies from Prisma
repositories directly" convention `trust-integrity/compose.ts`'s own doc
comment documents and `payments/compose.ts` already follows for this same
`TrustAutomatedActionRepository`.

Both gates are placed at the correct architectural layer (application-layer
use case, not a controller/Server Action), reuse the existing repository
interface unchanged, write nothing new, and never touch `TrustAutomatedAction`
itself — read-only enforcement against the existing ledger.

## Professional protection (Phase 4)

A professional with an active `BOOKING_RESTRICTION` can no longer have a
quote accepted against them, regardless of a valid `VERIFIED` verification
status from Module 83 — verification and trust/risk restriction are now two
independent gates that both must pass, exactly as the module brief requires
("must not become active merely because their verification documents are
valid"). No change to Module 83's own verification logic.

## Customer protection (Phase 5)

A customer with an active `BOOKING_RESTRICTION` cannot accept new quotes; a
customer (or professional) with an active `MESSAGING_RESTRICTION` cannot
send chat messages. Both reuse the exact same ledger/enforcement mechanism
already proven in production for `PAYOUT_HOLD`.

## Marketplace / off-platform protection (Phase 6)

Every chat message now feeds `DetectOffPlatformCommunicationUseCase`
(phone numbers, emails, external URLs, social handles — whatever
`off-platform-detection-rules.ts` already matches). A single low-confidence
match (e.g. a bare digit sequence) is recorded for visibility only; a
high-confidence match feeds `RecordUserBehaviorSignalUseCase`, which moves
the Risk Score through the existing, already-tested
`RISK_SCORE_DELTA_TABLE` and — once a tier threshold is crossed —
`trust-integrity-action-policy.ts`'s existing escalation produces a
`WARNING`/`MESSAGING_RESTRICTION`/`MANUAL_REVIEW`/etc automated action on
its own, through code that already existed and was already tested. This
module does not add a new enforcement decision here — it feeds the existing
one real data for the first time.

Quote text, service-request descriptions, and reviews are **not** scanned
by this pass — see "Out-of-scope findings."

## Admin / security integration (Phase 8)

No new admin surface, no new audit repository. Both gates throw the same
`ValidationError` class every other business-rule violation in this
codebase throws, surfaced through the existing HTTP-error-mapping layer.
Restrictions are created/reversed exclusively through Module 65's own
existing `ApplyAutomatedActionUseCase`/`ReviewAppealUseCase` (RBAC-gated
per Module 82, unmodified by this module) — this module only ever *reads*
`listActiveForUser`, never writes a `TrustAutomatedAction`.

## Idempotency & concurrency (Phase 9)

Both new checks are pure reads (`listActiveForUser`) re-executed fresh on
every call, immediately before the guarded write — identical placement and
pattern to the pre-existing `PAYOUT_HOLD` check in
`ExecuteProfessionalPayoutUseCase`. Neither check creates any row, so
duplicate detection / replay / concurrent-request concerns that apply to
*writing* a `TrustAutomatedAction` (already handled by Module 65's own
`ApplyAutomatedActionUseCase` and unchanged here) don't apply to this
module's changes. `AcceptQuoteUseCase`'s underlying atomic
`quoteAcceptance.acceptQuote(...)` transaction and its existing race-safe
status re-checks are completely unchanged — the new gate runs strictly
before it and never interferes with its concurrency guarantees.

## Financial safety (Phase 3)

Neither change touches a ledger row, a Commission, a Payment, a Payout, or
Stripe idempotency in any way. `AcceptQuoteUseCase` doesn't move money at
all (quote acceptance precedes payment); the new gate can only prevent a
booking from being created, never mutate one. `SendMessageUseCase` has no
financial surface. The pre-existing `PAYOUT_HOLD` financial gates are
untouched.

## Database (Phase 15)

**No migration.** `BOOKING_RESTRICTION` and `MESSAGING_RESTRICTION` already
existed as `TrustAutomatedActionType` enum values from Module 65's own
migration; `listActiveForUser` already existed on the repository interface
and its Prisma implementation. This module only adds callers.

## Tests added

- `tests/integration/quotes/fakes.ts`: `FakeQuoteAcceptanceRepository`
  (minimal in-memory double for the atomic accept-quote transaction) and
  `FakeTrustAutomatedActionRepository` (mirrors the existing
  `tests/unit/.../payments/fakes.ts` `PAYOUT_HOLD` pattern, generalized to
  any `TrustAutomatedActionTypeValue`).
- `tests/integration/quotes/quote-flows.test.ts` — new
  `AcceptQuoteUseCase — Module 89 BOOKING_RESTRICTION enforcement` suite (5
  tests): legitimate acceptance succeeds; backward-compatible when
  `trustAutomatedActions` is omitted; customer-side restriction blocks (and
  leaves the quote untouched — no partial mutation); professional-side
  restriction blocks; a restriction of an unrelated type (`PAYOUT_HOLD`)
  does not block.
- `tests/integration/chat/fakes.ts`: re-exports `FakeTrustAutomatedActionRepository`
  and adds `FakeDetectOffPlatformCommunicationUseCase` (a call-recording,
  optionally-throwing double for the detection use case).
- `tests/integration/chat/chat-flows.test.ts` — new
  `SendMessageUseCase — Module 89 trust signal activation` suite (5 tests):
  active `MESSAGING_RESTRICTION` blocks the send and nothing is persisted;
  an unrelated restriction type does not block; off-platform detection runs
  on every send with the exact expected payload; a detection failure never
  fails or undoes the send (best-effort, matching the doc comment);
  backward-compatible when neither optional dependency is supplied.

10 new tests total, all deterministic in-memory fixtures — no sleeps, no
timing-based assertions.

## Tests modified

None. No existing test was weakened, skipped, or deleted.

## Genuine production defects discovered (pre-existing, unrelated to Module 89)

1. `tests/unit/core/application/use-cases/reconciliation/fakes.ts` —
   `FakeReconciliationRunRepository`/`FakeReconciliationDiscrepancyRepository`
   are missing several methods (`count`, `list`, `countByResolutionStatus`,
   `getOpenSeverityCounts`, `getOpenCategoryCounts`, `getSeverityCountsForRun`)
   that `ReconciliationRunRepository`/`ReconciliationDiscrepancyRepository`
   now require — a pre-existing `tsc --noEmit` failure, confirmed present
   before this module's changes (git status shows these files untouched by
   this branch). Not fixed here — out of Module 89's scope and unrelated to
   fraud/trust; flagged for whoever owns Module 80/81 reconciliation.
2. `tests/unit/core/infrastructure/observability/http-error-response.test.ts` —
   flaky under this sandbox: two separate runs each failed a *different*
   assertion in this same file (`Test timed out in 5000ms` on one run,
   `expected "reportException" to be called 1 times, but got 2 times` /
   a debug-message assertion on another), both timing-sensitive. Unrelated
   file, untouched by this branch, reproduces without any Module 89 change
   present. Flagged, not fixed.

## False-positive safeguards (Phase 11)

Both new gates are pure enforcement of an *already-created* restriction —
they introduce no new detection logic, no new threshold, and no new
automatic-restriction creation path. The decision of *whether* to restrict
a user still runs entirely through Module 65's existing, already-tested
`risk-score-policy.ts` tiers and `trust-integrity-action-policy.ts`
escalation rules — completely unchanged by this module. This module cannot
introduce a new false-positive risk on its own because it creates zero new
restrictions; it only makes existing restrictions (which an admin or the
existing automated pipeline already decided to apply) actually consequential.
Every restriction enforced this way remains reversible exactly as before —
through the existing `ReviewAppealUseCase`/appeal workflow, unmodified.

## Exact validation results

- `npx tsc --noEmit`: **clean** for every file this module touched. 6
  pre-existing errors remain in
  `tests/unit/core/application/use-cases/reconciliation/{fakes,start-reconciliation-run.use-case.test}.ts`
  (see "Genuine production defects discovered" — confirmed unrelated, those
  files are untouched by this branch).
- `npm run lint` (full repo, `eslint .`): **clean, zero errors/warnings.**
- `git diff --check`: **clean** (exit 0, no whitespace errors).
- Targeted test run —
  `tests/integration/quotes tests/integration/chat tests/integration/trust-integrity tests/unit/core/domain/services`:
  **38 files, 403 tests, 403 passed, 0 failed.**
- Broader partial run — `tests/unit/core/domain tests/unit/core/infrastructure`:
  ran to completion once (no failures related to this module) and
  reproduced the pre-existing `http-error-response.test.ts` flake on a
  second run (2 different assertions failed across the two runs — a timing
  flake, not a regression from this branch).
- Broader partial run — `tests/unit/core/application`: 63 files / their
  tests passed before hitting this sandbox's 180-second per-command limit
  (502 total `tests/unit/**/*.test.ts{,x}` files exist repo-wide); the run
  did not reach a failure before timing out. **A full whole-repo `npm test`
  was not completed in this sandbox** — the suite's real wall-clock size
  exceeds the per-command time limit available here. This is a sandbox
  constraint, not a signal from the code changes themselves: every batch
  that *did* complete, including every batch touching the files this module
  changed or their direct dependents, passed in full.
- `npx prisma migrate status` / `prisma generate` / `npm run build`: not
  run — no schema change was made (see "Database" above), so there is
  nothing to migrate or regenerate; a full Next.js production build was out
  of budget for this pass and is recommended as part of Module 87's own
  final gate.

## Remaining risks

- The full unvalidated tail of `tests/unit` (roughly 350+ files not
  reached before the sandbox time limit) and the entire `tests/e2e` suite
  were not executed in this pass. None of them import the four files this
  module changed (confirmed by `grep -rl` for both changed use cases across
  `tests/`), so a regression there is unlikely, but it is not *proven* the
  way the 403 directly-relevant tests are.
- `npm run build` was not run — a type-level or bundling issue specific to
  Next.js's build graph (as opposed to `tsc --noEmit`, which was run) can't
  be fully ruled out, though the changes are ordinary TypeScript with no
  new routes, pages, or build-time constructs.

## Out-of-scope findings for Modules 88 and 90

- `DetectBookingAbuseUseCase`, `DetectFakeReviewPatternsUseCase`,
  `DetectSpamActivityUseCase`, `DetectSuspiciousPricingUseCase`,
  `DetectPaymentAbuseUseCase`, `DetectIdentityRiskUseCase`,
  `DetectFraudSignalsUseCase` remain built but disconnected. Each needs a
  real call site that supplies the aggregated/statistical input its
  signature already declares (e.g. `DetectBookingAbuseUseCase` wants
  `CancellationActivityInput[]`/`GhostPartyInput[]` — data that has to be
  computed from job/appointment history, not available at a single
  request's call site). This is a legitimate, scoped follow-up, not
  something to bolt onto Module 89's minimal-change mandate.
- Quote text, service-request descriptions, and review bodies are not run
  through `DetectOffPlatformCommunicationUseCase` — only chat messages are,
  in this pass. The DTO already declares `QUOTE`/`REVIEW`/`SERVICE_REQUEST`
  as valid `sourceType`s, so the seam is ready.
- `TrustAutomatedActionRepository.expireDue` still has no scheduled sweep —
  a restriction that should expire only actually lifts when something next
  calls `expireDue` or a manual appeal is filed. This is infrastructure
  (a cron/scheduled job), squarely Module 88's territory.

## Recommendations for final Module 87 hardening

- Run the full `npm test` and `npm run build` in an environment without
  this sandbox's per-command time limit, and re-run `npx tsc --noEmit`
  after the pre-existing reconciliation-fakes defect above is fixed by its
  owning module, so Module 87's final gate isn't carrying a known-red
  baseline into concurrency hardening.
- When `expireDue` gets a scheduler (Module 88), re-verify the
  `BOOKING_RESTRICTION`/`MESSAGING_RESTRICTION` checks added here still see
  consistent state under concurrent expiry — they already re-query fresh on
  every call, so this should be a verification step, not a code change.
- `User.status` suspension enforcement (still a documented Module 65
  limitation) is a natural concurrency-hardening candidate for Module 87
  once `UserRepository.updateStatus` exists.

# Final summary

- files changed: 4
  (`src/core/application/use-cases/{chat/compose.ts,chat/send-message.use-case.ts,quotes/accept-quote.use-case.ts,quotes/compose.ts}`)
- files added: 1 (this report) — plus test-only changes to
  `tests/integration/{quotes/fakes.ts,quotes/quote-flows.test.ts,chat/fakes.ts,chat/chat-flows.test.ts}`
- migrations added: 0
- tests added: 10
- tests modified: 0
- total tests executed: 403 (fully passing batch) + 63 (partial batch,
  no failures before timeout) = 466 confirmed passing; full-repo total not
  completed in this sandbox (see "Exact validation results")
- failures: 0 in every batch that reached completion; 2 pre-existing,
  unrelated flaky failures reproduced in `http-error-response.test.ts`
  (confirmed present without this branch's changes)
- typecheck result: clean for all files this module touched; 6 pre-existing
  unrelated errors remain (reconciliation fakes)
- lint result: clean, 0 errors/warnings (full repo)
- build result: not run (see "Remaining risks")
- git diff --check result: clean (exit 0)

# MODULE 89 VERDICT: COMPLETE WITH CONDITIONS

Conditions:
1. Before Module 87's final gate, run `npm test` and `npm run build` to
   completion in an environment without this sandbox's ~180s per-command
   limit, to cover the tail of `tests/unit` and all of `tests/e2e` this
   pass didn't reach.
2. The pre-existing `tests/unit/core/application/use-cases/reconciliation/fakes.ts`
   typecheck failure (unrelated to this module) should be fixed by its
   owning module before Module 87 treats `tsc --noEmit` as a clean gate.
3. The `http-error-response.test.ts` flake (unrelated to this module,
   timing-sensitive, reproduces without this branch's changes) should be
   investigated by whoever owns that file — it is not blocking Module 89's
   own changes but it is a real, currently-red test.
