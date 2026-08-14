# Module 62 — Professional Onboarding

## Purpose

A professional must complete onboarding before being allowed to receive
bookings or payouts. This module is the orchestration layer that ties
together every prerequisite that already exists elsewhere in the codebase —
it introduces exactly two new tables (`ProfessionalOnboarding`,
`ProfessionalPayoutAccount`) and reuses everything else.

## What this module reuses (never duplicates)

| Requirement | Owned by | This module's role |
| --- | --- | --- |
| Terms & Conditions acceptance | Module 38 GDPR `Consent` (`TERMS_OF_SERVICE`) | `AcceptOnboardingTermsUseCase` writes through the existing `ConsentRepository`, with two additive columns (`ipHash`, `userAgent`) the module brief specifically requires for this step. |
| Privacy Policy acceptance | Module 38 GDPR `Consent` (`PRIVACY_POLICY`) | `AcceptOnboardingPrivacyPolicyUseCase`, same reuse, no ipHash/userAgent required. |
| Identity (KYC) verification | Module 17 (manual) / Module 59 (Persona) `ProfessionalVerificationRepository` | `GetOnboardingStatusUseCase` reads the live case status directly; `isIdentityVerified()` treats `APPROVED` as satisfied — the same predicate Module 59's `canReceivePayouts()` already established. No parallel verification state machine. |
| Profile completeness | `ProfessionalRepository` / `AddressRepository` | `isProfileComplete()` only checks presence of existing fields (business name, bio, phone, service radius, years of experience, at least one category, a saved primary address). Field-level format rules remain `professional.dto.ts`'s job. |
| Bank account / payout destination | New: `ProfessionalPayoutAccount` | Behind a `PayoutProvider` port — `IbanPayoutProvider` (local validation, no external call) and `StripeExpressPayoutProvider` (state-preparation only). |
| Final activation | New: `ProfessionalOnboarding` | `ActivateProfessionalUseCase` requires every one of the five steps above, server-side, with no shortcuts. |

## Domain

- `domain/services/professional-onboarding-rules.ts` — pure functions: step
  vocabulary, profile-completeness check, IBAN validation (ISO 13616 /
  mod-97), masking, and `computeOnboardingProgress()`, the single function
  every read path and the activation gate both call.
- `domain/repositories/professional-onboarding-repository.ts` — the two new
  tables' repository interface.
- `domain/events/professional-onboarding-activated.ts` — raised exactly once
  per professional, audit-logged by `RecordOnboardingActivatedAuditLogSubscriber`.

## Application

`application/use-cases/onboarding/`: `StartProfessionalOnboardingUseCase`,
`AcceptOnboardingTermsUseCase`, `AcceptOnboardingPrivacyPolicyUseCase`,
`SetPayoutDestinationUseCase`, `GetOnboardingStatusUseCase`,
`ValidateProfessionalActivationUseCase`, `ActivateProfessionalUseCase`.

`application/ports/payout-provider.ts` — the `PayoutProvider` abstraction;
no bank-API or Stripe SDK type appears in this port, mirroring
`PaymentGateway`/`VerificationProvider`'s own rule.

## Provider abstraction

`infrastructure/payout/`:
- `iban-payout-provider.ts` — validates/masks/hashes an IBAN locally, no
  external call; always registers as `PENDING` (structurally valid, not
  bank-verified).
- `stripe-express-payout-provider.ts` — **no Stripe SDK import, no Stripe
  API call.** Only records that the professional chose Stripe Express and
  is ready for Module 65 to create a real Connect account.
- `payout-provider-factory.ts` — the one place a `PayoutMethodValue`
  resolves to a concrete provider; adding a third method is one adapter and
  one `case`.

## Deliberately out of scope

- **Wiring the activation gate into booking/payout creation.** This module
  publishes `ProfessionalOnboardingActivated` and exposes
  `ValidateProfessionalActivationUseCase`, but no existing
  `ServiceRequest`/`Appointment`/`Payout` use case has been modified to
  require `ProfessionalOnboarding.status === "ACTIVATED"`. Wiring that in
  touches modules well outside this one's blast radius; it's a follow-up.
- **Stripe Express account creation** (Module 65) — this module prepares
  state only, per its own explicit instruction.
- **Webhook processing** for any future payout-provider callback — not
  requested by this module's brief.

## Reports

`npm run onboarding-report` → `reports/onboarding-report.{md,json}`.
Database access is best-effort — a report is always written even when the
database is unreachable (see `scripts/run-onboarding-report.ts`'s own doc
comment), matching `verification-report`/`affiliate-report`/`referral-report`'s
existing precedent.
