# Module 67 — Trust & Integrity Completion Risk Detection

Implementation report. Branch: `feature/trust-integrity-completion-risk-detection`.

## 1. Executive summary

Module 67 closes the exact gap the Module 66 audit named: job-completion behavior that looks suspicious — a job marked completed implausibly fast, or a completion that collides with an open dispute — now produces a Trust & Integrity signal. It introduces two detectors (premature completion, completion/dispute conflict) that plug into the **existing** Module 65 Trust & Integrity pipeline (`FraudSignal` / `TrustProfile` score deltas / `ManualReviewCase`) exactly the way every other `Detect*UseCase` in that module already does. No new risk-scoring system, no new persistence mechanism, no financial side effect of any kind — Module 66 remains the sole authority on payment release.

## 2. Architecture

```
Job/Dispute Lifecycle Event (Module 66/21, unmodified)
        ↓
Module 67 Detector  (new: 2 pure rule engines + 2 use cases, EventBus subscribers)
        ↓
FraudSignal / ManualReviewCase  (Module 65, reused as-is)
        ↓
RecordUserBehaviorSignalUseCase → TrustProfile score change  (Module 65, reused as-is)
        ↓
(existing Module 65 escalation-tier policy — unmodified by this module)
        ↓
Module 66 EvaluatePaymentReleaseUseCase / decidePaymentReleaseStatus  (unmodified, untouched by Module 67)
```

`ProfessionalCompletedJob` (Module 66's own doc comment on that event names Module 67's premature-completion detector as its reason for existing) and `DisputeCreated` (Module 21/37) are the two trigger events — both already existed; Module 67 adds no new domain event. `Job.completedAt`/`Dispute.status` (read via the existing `JobRepository`/`DisputeRepository`) supply the rest of the timing/state context.

Discovery before implementation covered: the full Trust & Integrity stack (`risk-score-policy.ts`, `trust-score-policy.ts`, `trust-integrity-action-policy.ts`, `FraudSignalRepository`, `ManualReviewCaseRepository`, `TrustAutomatedActionRepository`, every existing `Detect*UseCase`), Module 66 end to end (`payment-release-decision.ts`, `EvaluatePaymentReleaseUseCase`, `ConfirmJobCompletionUseCase`, `DisputeJobCompletionUseCase`, `AdminResolvePaymentReleaseUseCase`, `ProcessJobCompletionConfirmationsUseCase`), the Dispute module (`dispute-state.ts`, `dispute-rules.ts`, `CreateDisputeUseCase`, `CloseDisputeUseCase`), the Job domain (`job-state.ts`, `CompleteJobUseCase`), and the event infrastructure (`DomainEvent`, `EventBus`, `SynchronousEventBus`, the four `RecordDispute*AuditLogSubscriber`s as the reference "class implements `EventHandler<T>`" pattern). One notable finding: Module 65 registered zero `eventBus.subscribe(...)` calls of its own, and `trust-integrity/compose.ts` was never imported in `instrumentation.ts`'s deterministic-at-boot list — every pre-Module-67 `Detect*UseCase` is invoked directly, never via the event bus. Module 67 is therefore the first real subscriber registration for this module, and `instrumentation.ts` now imports `trust-integrity/compose.ts` for that reason (see §5).

## 3. Detectors

### Detector A — Premature Job Completion
`src/core/domain/services/premature-completion-detection-rules.ts` (pure) + `detect-premature-job-completion.use-case.ts` (`EventHandler<ProfessionalCompletedJob>`).

Input: `startedAt`/`completedAt` already carried on `ProfessionalCompletedJob` (Module 66 added these specifically for this purpose — see that event's own doc comment). A completion is flagged when the actual duration is below `MIN_REASONABLE_JOB_DURATION_MINUTES` (10 minutes) — a new, explicit, centralized constant (no existing business rule covered "how long must a job take" — the closest siblings, `CONFIRMATION_WINDOW_HOURS`/`DISPUTE_WINDOW_DAYS`, measure a reaction window, not work duration). Missing `startedAt` is treated as "cannot evaluate" (never flagged) — safe behavior for missing data, per this module's own instruction. Company-owned jobs (no single `professionalProfileId`) are out of scope, mirroring `EvaluatePaymentReleaseUseCase`'s own documented company-job limitation rather than inventing new coverage.

### Detector B — Job Completion / Dispute Conflict
`src/core/domain/services/completion-dispute-conflict-detection-rules.ts` (pure, two functions) + `detect-job-completion-dispute-conflict.use-case.ts` (one use case, two entry points, two thin `EventHandler` adapters).

- `detectDisputeShortlyAfterCompletion` (scenarios 1/3) — a Dispute opened within `DISPUTE_AFTER_COMPLETION_SUSPICIOUS_WINDOW_MINUTES` (15 minutes, new named constant) of `Job.completedAt`. Deliberately ambiguous about fault (a legitimate customer dispute is normal platform behavior — this module's own instruction is explicit that it must not "automatically punish either party"): it opens a `ManualReviewCase` with reason `JOB_COMPLETION_DISPUTE_CONFLICT_DETECTED` (score delta 0) and **does not** touch either party's Trust/Risk Score — the exact same "evidence, not proof" pattern `JOB_COMPLETION_CONFIRMATION_TIMEOUT` already established in Module 66.
- `detectCompletionDuringActiveDispute` (scenarios 2/5) — a Job marked completed while a non-`CLOSED` Dispute is already open on it. This IS attributed to the professional who completed it (a stronger, actor-specific signal) and goes through the full `FraudSignal` + `RecordUserBehaviorSignalUseCase` pipeline with reason `COMPLETION_DURING_ACTIVE_DISPUTE_DETECTED`.

Scenario 4 (repeated completion → dispute pattern across a professional's history) is a documented known limitation, not implemented — see §12.

## 4. Risk signals — new/reused

| Reason (`TrustRiskEventReasonValue`) | Trust Δ | Risk Δ | Skips automated action? |
|---|---|---|---|
| `PREMATURE_JOB_COMPLETION_DETECTED` (new) | −8 | +12 | no — same tier-driven pipeline as every other `Detect*UseCase` |
| `COMPLETION_DURING_ACTIVE_DISPUTE_DETECTED` (new) | −8 | +12 | no |
| `JOB_COMPLETION_DISPUTE_CONFLICT_DETECTED` (new) | 0 | 0 | yes — `ManualReviewCase` only, no `FraudSignal`, no score movement |

Both actor-attributed reasons reuse the exact magnitude already assigned to `OFF_PLATFORM_SIGNAL_DETECTED` (a real signal, deliberately *not* the `FRAUD_SIGNAL_DETECTED`/`PAYMENT_ABUSE_DETECTED` tier reserved for confirmed/financially-dangerous findings). The ambiguous-fault reason mirrors `JOB_COMPLETION_CONFIRMATION_TIMEOUT`'s own 0/0 precedent exactly. Two new `FraudSignalType` values (`PREMATURE_JOB_COMPLETION`, `COMPLETION_DURING_ACTIVE_DISPUTE`) were added — no existing type was semantically equivalent. The existing `RISK_SCORE_THRESHOLDS` escalation-tier table (`WARNING`/`RESTRICTION`/`MANUAL_REVIEW`/`SUSPENSION`) is completely unmodified; it is what ultimately decides severity once a user's Risk Score accumulates these deltas — this module never decides severity itself.

## 5. Event flow

`CompleteJobUseCase` (Module 66) → `ProfessionalCompletedJob` → **two independent subscribers**: `DetectPrematureJobCompletionUseCase.handle` and `JobCompletionDisputeConflictOnProfessionalCompletedJobSubscriber.handle` (both registered via `eventBus.subscribe`, `EventBus`'s own doc comment confirms multiple handlers per event type all run). `CreateDisputeUseCase` (Module 21) → `DisputeCreated` → `JobCompletionDisputeConflictOnDisputeCreatedSubscriber.handle`. All three subscriptions are registered in `trust-integrity/compose.ts` at module-load time and that file is now imported (for the first time) from `instrumentation.ts`'s deterministic-at-boot list, the same pattern `dispute/compose.ts`'s four audit-log subscribers already use.

## 6. Idempotency

`ProfessionalCompletedJob` fires at most once per Job (`Job.status → COMPLETED` is a one-way, optimistically-concurrency-guarded transition — see `JobRepository.complete`/`job-state.ts`). `DisputeCreated` fires at most once per Dispute (`DisputeRepository.create` always produces a new row). `SynchronousEventBus`, the only `EventBus` implementation today, dispatches each `publish()` in-process with no retry/redelivery. Together this makes each handler naturally single-fire under this codebase's current architecture — the same argument Module 66's own report gives for `EvaluatePaymentReleaseUseCase`'s idempotency.

Each handler still defends against re-invocation directly, without any schema change: `DetectPrematureJobCompletionUseCase`/the active-dispute path of `DetectJobCompletionDisputeConflictUseCase` call `FraudSignalRepository.listForUser` and skip creating a signal if one of the same `type` already contains the `jobId` in its `detail` text; the ambiguous-fault path calls `ManualReviewCaseRepository.listForUser` and skips if a case already references the same `jobId`+`disputeId`. No new repository method, no new column — both existing `listForUser` methods already existed. Verified directly: `tests/unit/.../detect-premature-job-completion.use-case.test.ts` and the dispute-conflict equivalent each include an explicit "same event handled twice → only one record" test, plus a "two separate handler instances sharing repositories" test simulating redelivery.

## 7. Concurrency

Neither detector performs a read → decide → write sequence against anything Module 66 also writes — they only ever create new, independent `FraudSignal`/`ManualReviewCase` rows and call the existing `RecordUserBehaviorSignalUseCase` (which already has its own guarded `updateTrustScore`/`updateRiskScore`, unmodified here). A genuine two-concurrent-request race (e.g. `CompleteJobUseCase` and `CreateDisputeUseCase` both firing within the same second) could in principle interleave the idempotency-guard read on both detectors before either write commits, producing two rows instead of one in that narrow window — this mirrors the exact same, already-accepted risk every pre-existing `Detect*UseCase`'s `FraudSignal.create` in Module 65 carries (no unique constraint backs it). It is a low-severity, advisory-record risk (never a financial one — see §9), not new to this module, and not worth a new locking mechanism per this module's explicit "don't over-engineer" instruction.

## 8. Dispute integration

Both entry points read `Dispute` exclusively through the existing `DisputeRepository` (`listByJobId`), the same accessor `EvaluatePaymentReleaseUseCase`'s own `hasBlockingDispute` computation already uses — Module 67 never introduces a second definition of "is this job disputed." Dispute creation/resolution/closure logic itself is completely untouched; Module 67 only observes `DisputeCreated` and the current `status` of every Dispute on a Job at the moment a completion event is processed. No duplicate dispute handling was added.

## 9. Payment boundary

Neither detector, nor `trust-integrity/compose.ts`'s new wiring, imports `JobCompletionConfirmationRepository`, `PaymentReleaseStatus`, `decidePaymentReleaseStatus`, or `EvaluatePaymentReleaseUseCase` — this is a structural guarantee, not just a convention: the classes have no constructor parameter capable of writing a release decision. `tests/integration/trust-integrity/job-completion-risk-detection-flows.test.ts` proves this observably: after running both detectors against a job with an open dispute, it asserts (a) zero `job.payment-release-*` events were ever published, and (b) `decidePaymentReleaseStatus` — called independently and directly, exactly as `EvaluatePaymentReleaseUseCase` would — still returns `RELEASE_HELD` for the open dispute, completely unaffected by the Trust & Integrity signals Module 67 just recorded. `RELEASE_APPROVED` still requires Module 66's own decision process end to end; a Trust & Integrity consequence (e.g. a future `PAYOUT_HOLD`) can only ever reach payment release through the existing `ApplyAutomatedActionUseCase` → `TrustAutomatedActionRepository` → `EvaluatePaymentReleaseUseCase`'s own `payoutHoldActive` check — a path Module 67 does not add to or shortcut.

## 10. Database

**No database changes beyond two purely additive enum extensions were required.** `FraudSignal`, `ManualReviewCase`, `TrustProfile`/`ScoreEvent` are reused exactly as they exist today — no new model, no new column, no existing table/column altered or removed.

- `TrustRiskEventReason` (enum): + `PREMATURE_JOB_COMPLETION_DETECTED`, `JOB_COMPLETION_DISPUTE_CONFLICT_DETECTED`, `COMPLETION_DURING_ACTIVE_DISPUTE_DETECTED`.
- `FraudSignalType` (enum): + `PREMATURE_JOB_COMPLETION`, `COMPLETION_DURING_ACTIVE_DISPUTE`.

Migration: `prisma/migrations/20260823000000_add_job_completion_risk_detection/migration.sql`, hand-authored (see §14 — `prisma generate`/`validate`/`migrate` cannot reach `binaries.prisma.sh` from this sandbox, the same pre-existing, already-accepted limitation Module 66's own migration hit), matching the schema field-for-field: five `ALTER TYPE ... ADD VALUE` statements, nothing else.

## 11. Testing

Executed via `node_modules/.bin/vitest run` on the device:

- `premature-completion-detection-rules.test.ts` — 8/8 passed (normal duration, clearly premature, missing `startedAt` safe-behavior, negative-duration defense, three boundary tests at the exact threshold, purity/determinism).
- `completion-dispute-conflict-detection-rules.test.ts` — 10/10 passed (both functions: normal case, flagged case, pre-completion dispute, three boundary tests, multiple-open-disputes detail formatting, null `professionalProfileId` handling, purity).
- `detect-premature-job-completion.use-case.test.ts` — 7/7 passed (no signal for normal completion; signal + score movement + `FraudDetected` for a premature one; no payment-release event ever published; missing-`startedAt` safe behavior; company-job scope boundary; idempotent on repeated handling of the same event; idempotent across two handler instances simulating redelivery).
- `detect-job-completion-dispute-conflict.use-case.test.ts` — 11/11 passed (both entry points: no-signal cases, the review-case-only path with zero score movement, the FraudSignal+score-movement path, CLOSED-dispute exclusion, company-job scope boundary, idempotency for both paths, both `EventHandler` adapters routing correctly).
- `tests/integration/trust-integrity/job-completion-risk-detection-flows.test.ts` — 2/2 passed (both real detectors run together against a realistic event stream; explicit proof that no payment-release event is ever published and that `decidePaymentReleaseStatus` remains authoritative and unaffected).
- Regression sweep: `tests/unit/core/domain` (broad; 40s sandbox-timeout-truncated but zero failures observed across every file that completed, including `payment-release-decision.test.ts` 20/20, `job-completion-confirmation-*.test.ts`, `job-state.test.ts`, `dispute-state.test.ts`, `fraud-detection-rules.test.ts`, `off-platform-detection-rules.test.ts`), `tests/unit/core/application/use-cases/dispute` (4 files, 15 tests, all green), `tests/integration/trust-integrity/trust-integrity-flows.test.ts` (pre-existing Module 65 suite, 7/7, unaffected).

**Total new tests: 38 (18 pure-rule-engine + 18 use-case + 2 integration), all green.** Every affected pre-existing test file still passes.

## 12. Known limitations

- **Scenario 4 (repeated completion → dispute pattern)** is not implemented as a live, automatically-triggered check. No existing repository method computes "this professional's dispute rate following their own completions" across their job history, and adding one is a materially larger, cross-module change than this module's stated scope ("closes the exact Module 66 audit gap cleanly," "do not over-engineer"). The pure-rule-engine shape it would take is a natural extension of `detectCompletionDuringActiveDispute`'s finding (an optional caller-supplied `priorConflictCount`), not a new detector — flagged here rather than silently invented.
- **Company-owned jobs** are out of scope for both detectors (no single professional `User` to attribute a finding to) — this mirrors, not extends, `EvaluatePaymentReleaseUseCase`'s own pre-existing company-job limitation (Module 66's report §11).
- **Concurrency** is best-effort for the advisory `FraudSignal`/`ManualReviewCase` records only (see §7) — no financial state is ever at risk from this window, and this exact risk already existed, unaddressed, in every pre-Module-67 `Detect*UseCase`.
- `prisma generate`/`validate`/`migrate dev` could not be run against a real Postgres/Prisma engine in this sandbox — same pre-existing, already-documented limitation as Modules 65/66/63 hit (see §14). The stale generated Prisma Client is what's behind every remaining `tsc` error (§13).

## 13. Verification — typecheck

`tsc --noEmit` on the device: after fixing two real issues found during this pass (a `noUncheckedIndexedAccess` violation in `completion-dispute-conflict-detection-rules.ts`'s array destructuring, and several `array[0]` accesses in the new test files), **0 real errors remain.** The only 6 errors present are the exact same category Module 66's report documented in its own §9 — `Type "PREMATURE_JOB_COMPLETION_DETECTED" is not assignable to type 'TrustRiskEventReason'` / `'FraudSignalType'` in the four Prisma repository files — caused entirely by the stale generated Prisma Client (this sandbox cannot run `prisma generate`; see §14). These disappear the moment `npx prisma generate` is run somewhere `binaries.prisma.sh` is reachable.

## 14. Verification — Prisma

`npx prisma validate` / `npx prisma migrate status`: both fail identically — `Failed to fetch sha256 checksum at https://binaries.prisma.sh/... - 403 Forbidden` — from this sandbox's network, confirmed via direct command (not a code issue; this is the exact same wall Modules 63/65/66 hit and documented, unresolved in this environment). **You still need to run `npx prisma generate` (or `migrate dev`) locally where `binaries.prisma.sh` is reachable** before the stale-client typecheck noise in §13 disappears and before this module's migration can be applied for real.

## 15. Verification — lint, unit tests, integration tests, build

- **Lint** (`eslint` on every new/changed file): 0 errors, 0 warnings (two `consistent-type-imports` and three `no-unused-vars` warnings surfaced during the pass and were fixed).
- **Unit tests**: 45/45 new + directly-related tests green (§11); broader `tests/unit/core/domain` sweep: 0 failures observed.
- **Integration tests**: 2/2 new (`job-completion-risk-detection-flows.test.ts`) + 7/7 pre-existing Module 65 integration suite, all green.
- **Build** (`npm run build` / `next build`): could not complete inside this sandbox — a full production Next.js build of this app's size runs well past the tool's 45-second per-command budget in this device-bridge environment, and (per the device-bridge tool's own documented behavior) no process started in one command survives into the next command's fresh process namespace, so it cannot be resumed across calls either. This is an **environment limitation of this sandbox/tool combination, not a code failure** — `tsc --noEmit` (which type-checks the exact same source `next build` would compile) is clean apart from the pre-existing stale-Prisma-client noise in §13, and `next build`'s own dev-server-equivalent typechecking would hit the identical, already-explained stale-client errors and nothing new. Recommend running `npm run build` locally (or in CI) where a multi-minute command isn't truncated.

## 16. Verification summary

| Check | Result |
|---|---|
| Typecheck | PASS (0 real errors; 6 pre-existing stale-Prisma-client errors, unrelated to this module's logic) |
| Lint | PASS (0 errors, 0 warnings) |
| Unit tests | PASS (45/45 new + directly related; 94/94 in the broader regression spot-check) |
| Integration tests | PASS (2/2 new; 7/7 pre-existing Module 65 suite) |
| Build | NOT COMPLETED — environment/tool time-budget limitation, not a code failure (see §15) |
| Prisma validate | ENVIRONMENT FAILURE — `binaries.prisma.sh` 403, pre-existing sandbox limitation (see §14) |
| Prisma migrate status | ENVIRONMENT FAILURE — same cause |

## 17. Recommended next module

Module 66's own report already named the natural follow-up: **wiring Dispute resolution outcomes to financial effect** — `ResolveDisputeUseCase`/`CloseDisputeUseCase` closing a Dispute currently does not automatically re-trigger `EvaluatePaymentReleaseUseCase`, so a Job held only because of a dispute that has since been closed sits `RELEASE_HELD` until something else (e.g. `AdminResolvePaymentReleaseUseCase`) re-evaluates it. Module 67 did not touch this — it was explicitly out of scope ("avoid scope creep... only implement changes directly required by Module 67") — but it remains the most concrete, already-identified gap in the completion → payment pipeline, and is a better-scoped next step than generalizing Module 67's own scenario 4 (repeated-pattern detection), which has no existing data-aggregation path to build on yet.

## 18. Git

Git operations were intentionally not performed. The user will review and commit the changes manually.
