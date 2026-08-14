# Module 65 — Trust & Integrity System

## Purpose

The centralized Risk Management layer for the MaestroYa marketplace: a
Trust Score and an independent Risk Score for every user, a rule-based
detection engine covering off-platform communication, fraud, fake reviews,
spam, suspicious pricing, booking abuse, payment abuse, and identity risk,
a configurable automated-action framework (warning through permanent
suspension), a manual investigation queue, and an appeal workflow. No AI/
LLM is integrated anywhere in this module — every detector is a named,
reviewable rule engine. No UI, API route, or Server Action is included —
this module is architecture and business rules only, ready for a future
admin surface to consume.

## What this module owns (new tables)

Eight new tables, all additive: `TrustProfile`, `ScoreEvent` (shared by
both Trust Score and Risk Score changes, distinguished by `scoreType`),
`OffPlatformDetectionEvent`, `FraudSignal`, `TrustAutomatedAction`,
`ManualReviewCase`, `TrustAppeal`. See
`prisma/migrations/20260821000000_add_trust_integrity_system/migration.sql`.

## What this module reuses (never duplicates)

| Requirement | Owned by | This module's role |
| --- | --- | --- |
| Account-level lifecycle (`ACTIVE`/`SUSPENDED`/`BANNED`) | Module 1 `User.status` | Not written by this module today — see "Suspension enforcement" below. |
| Throttling/blocking overlay | Module 24 `AccountRestriction` | `ApplyAutomatedActionUseCase` layers a `TEMPORARILY_BLOCKED` `AccountRestriction` (reason `OTHER`) alongside a `TEMPORARY_RESTRICTION` `TrustAutomatedAction`, reusing the already-enforced mechanism. |
| Professional identity verification | Module 59 `ProfessionalVerificationRepository` | `identity-risk-rules.ts` classifies risk from a caller-supplied summary of Module 59's own state; verification logic itself is never re-implemented. |
| Pricing math (Total = Labour + Materials) | Module 64 `PricingCalculationService` | `suspicious-pricing-detection-rules.ts` consumes `PricingBreakdown` directly; no pricing arithmetic is duplicated. |
| Commission math | Module 64 `CommissionCalculationService`/`commission-policy.ts` | `payment-abuse-detection-rules.ts`'s amount-mismatch signal is derived by the caller comparing a Payment against `calculateCommissionBreakdown`'s output. |
| Affiliate-specific fraud | Module 61 `PartnerFraudFlag` | Kept as its own table for partner-scoped fraud; `FraudSignal` is the general-purpose (any user) counterpart, not a replacement. |
| Domain event dispatch | Module 34 `EventBus` | Every Module 65 use case publishes through the shared `eventBus` singleton (`infrastructure/events/compose.ts`). |

## Trust Score & Risk Score

Two independent 0-100 integers per user (`TrustProfile.trustScore`/
`riskScore`), recalculated exclusively through
`RecordUserBehaviorSignalUseCase`, which is the only code path allowed to
write to `TrustProfile`. Every delta comes from a closed, named table
(`TRUST_SCORE_DELTA_TABLE`/`RISK_SCORE_DELTA_TABLE` in
`trust-score-policy.ts`/`risk-score-policy.ts`) — never an arbitrary
caller-supplied number, except for the one `ADMIN_ADJUSTMENT` reason, which
always requires an explicit override. Every change is written to an
append-only `ScoreEvent` row (`scoreType: "TRUST" | "RISK"`) and announced
via `TrustScoreChanged`/`RiskScoreChanged`.

## Risk escalation tiers

`risk-score-policy.ts`'s `RISK_SCORE_THRESHOLDS` defines four bands —
`WARNING` (30), `RESTRICTION` (50), `MANUAL_REVIEW` (70), `SUSPENSION`
(85) — the exact vocabulary ("warning / restriction / suspension / manual
review / appeal") the module brief names explicitly.
`trust-integrity-action-policy.ts`'s `decideAutomatedAction` maps a tier,
plus whether the user already has an active action at the same tier or
above, to a concrete `TrustAutomatedActionType` — a first offense at
`RESTRICTION` yields `TEMPORARY_RESTRICTION`; a repeat offense escalates to
`MANUAL_REVIEW`. The whole mapping is configurable via `ActionPolicyConfig`.

## Detection rule engines

Ten pure, dependency-free rule-engine modules under
`src/core/domain/services/`: `off-platform-detection-rules.ts`,
`fraud-detection-rules.ts`, `fake-review-detection-rules.ts`,
`spam-detection-rules.ts`, `suspicious-pricing-detection-rules.ts`,
`booking-abuse-detection-rules.ts`, `payment-abuse-detection-rules.ts`,
`identity-risk-rules.ts`. Every function takes caller-supplied data (never
queries a database itself) and returns a typed finding — the corresponding
`Detect*UseCase` in `application/use-cases/trust-integrity/` persists a
`FraudSignal`/`OffPlatformDetectionEvent` and feeds
`RecordUserBehaviorSignalUseCase`.

## Provider abstractions (no external SDK integrated)

Five ports in `application/ports/`, each with a working default
implementation in `infrastructure/trust-integrity/`, resolved through
`trust-integrity-provider-factory.ts`:

- `DeviceFingerprintProvider` — `NullDeviceFingerprintProvider` (derives a
  best-effort hash from whatever client payload is supplied).
- `VpnProxyDetectionProvider` — `NullVpnProxyDetectionProvider` (always
  `UNKNOWN`).
- `DisposableEmailProvider` — `StaticListDisposableEmailProvider` (a small
  bundled domain list, no network call).
- `PhoneReputationProvider` — `NullPhoneReputationProvider` (always
  neutral).
- `OffPlatformDetectionProvider` — `RuleBasedOffPlatformDetectionProvider`,
  the only implementation that matters today, delegating to
  `off-platform-detection-rules.ts`.

## Automated actions

`TrustAutomatedActionType`: `WARNING`, `TEMPORARY_RESTRICTION`,
`BOOKING_RESTRICTION`, `MESSAGING_RESTRICTION`, `PAYOUT_HOLD`,
`MANUAL_REVIEW`, `TEMPORARY_SUSPENSION`, `PERMANENT_SUSPENSION`. Every
action is written to the `TrustAutomatedAction` ledger by
`ApplyAutomatedActionUseCase`, the single place this module ever writes
one. `PAYMENT_ABUSE_DETECTED` always additionally applies a defensive
`PAYOUT_HOLD` regardless of tier (`requiresPayoutHold`).

### Suspension enforcement is a documented limitation

`TEMPORARY_SUSPENSION`/`PERMANENT_SUSPENSION` are recorded on the ledger
and announced via `AccountSuspended`, but this module does not flip
`User.status` itself — `UserRepository` (Module 1) has no `updateStatus`
method today, and widening that foundational, widely-implemented interface
is out of this module's scope. A future module adds that method and a
session-invalidation subscriber to `AccountSuspended`; today, an admin
reviewing an active suspension action enforces it manually via the
existing admin user-management surface.

## Manual review queue & appeals

`ManualReviewCase` (`domain/entities/manual-review-case.ts`): `OPEN ->
UNDER_REVIEW -> ESCALATED -> RESOLVED | REJECTED`, with `UNDER_REVIEW` and
`ESCALATED` both able to resolve/reject directly. `TrustAppeal`
(`domain/entities/appeal.ts`): `SUBMITTED -> UNDER_REVIEW -> APPROVED |
REJECTED`, and `APPROVED -> ACCOUNT_RESTORED` as its own explicit step.
`ReviewAppealUseCase` reverses the underlying `TrustAutomatedAction`,
restores trust via the `APPEAL_APPROVED` reason, and publishes
`AccountReinstated` only once the account is actually restored.

## Domain events

`TrustScoreChanged`, `RiskScoreChanged`, `OffPlatformDetected`,
`FraudDetected`, `ManualReviewCreated`, `ManualReviewResolved`,
`AccountRestricted`, `AccountSuspended`, `AccountReinstated`,
`AppealSubmitted`, `AppealApproved`, `AppealRejected` — all in
`src/core/domain/events/`, dispatched through the shared `EventBus`.

## Report

`npm run trust-report` runs `scripts/run-trust-report.ts`, writing
`reports/trust-report.md`/`.json` — same pattern as every `run-*-report.ts`
script in this codebase (best-effort database access, real rule-engine
invocations and `SourceScanner`-based static checks, never asserted-only
narrative).

## Future integration readiness

- A scheduled sweep should call `TrustAutomatedActionRepository.expireDue`
  periodically (this module defines the method; nothing schedules it yet).
- Booking/messaging modules should consult
  `TrustAutomatedActionRepository.listActiveForUser(userId, "BOOKING_RESTRICTION"
  | "MESSAGING_RESTRICTION")` before allowing the corresponding action —
  not wired into Module 11/Job or the messaging module yet.
- Real device-fingerprint/VPN-proxy/phone-reputation providers can be
  dropped in by implementing the existing port interfaces and updating
  `trust-integrity-provider-factory.ts`; no use case changes.
- `User.status` suspension enforcement — see "Suspension enforcement" above.
