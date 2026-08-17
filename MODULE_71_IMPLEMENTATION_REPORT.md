# Module 71 — Stripe Connect: Implementation Report

> **Post-audit correction notice (see `docs/MODULE_71_STRIPE_CONNECT.md` for the full ADR):** an architecture audit of this module found that (1) the connected-account capability request originally included an unnecessary `card_payments` capability, and (2) the payout-eligibility formula (`chargesEnabled && payoutsEnabled`) was permanently `false` for every account this module creates, because `charges_enabled` is tied to `card_payments`, which this Connect model never uses. Both have been corrected: only `transfers` is requested, and readiness is now derived from `transfersActive` (`capabilities.transfers === "active"`) and `payoutsEnabled`. Section 3's stated rationale for choosing Separate Charges and Transfers has also been corrected below — the primary reason is separating payment capture from payout release (Module 66), not refund/dispute control, which is a secondary property of the model rather than the deciding factor. The corrections are code-complete and covered by tests, but have not been validated against a live Stripe test-mode account (no real credentials/network access exist in this environment) — see the post-audit report for the exact verification status.

## 1. Summary

Implemented the Stripe Connect infrastructure that lets MaestroYa associate a professional with a real Stripe Express connected account, drive them through Stripe's hosted onboarding, synchronize the account's capability state, and open the Stripe Express Dashboard — without implementing payment execution, webhooks, or VAT/invoicing (reserved for Modules 72/73). Every new piece builds directly on infrastructure Modules 62/64/35 had already reserved for this: `ProfessionalPayoutAccount.stripeExpressAccountId`/`stripeExpressStatus`, `StripeExpressPayoutProvider`, the shared `stripe` SDK client, and `CommissionCalculationService`.

## 2. Architecture

```
Application (use cases)
        |
StripeConnectGateway (port — application/ports/stripe-connect-gateway.ts)
        |
StripeConnectGatewayAdapter (infrastructure/payments/stripe/stripe-connect-gateway.ts)
        |
Stripe SDK (existing singleton client, infrastructure/payments/stripe/client.ts)
        |
Stripe API
```

The domain layer contains zero Stripe references. `application/ports/stripe-connect-gateway.ts` is the only interface application code depends on; no `Stripe.Account`/`Stripe.AccountLink` type crosses it. `StripeConnectGatewayAdapter` is the single file that imports the Stripe SDK, maps Stripe's vocabulary onto plain DTOs, and translates every SDK error into a `StripeConnectError` (never a raw Stripe exception). This mirrors the exact pattern already established by `PaymentGateway`/`VerificationProvider` (Persona) in this codebase — no new architectural style was introduced.

Three distinct states are modeled, never collapsed into one boolean (`domain/services/stripe-connect-account-rules.ts`):
- **MaestroYa professional status** (`ProfessionalProfile.status`) — untouched by this module.
- **Stripe Connect account status** (`ProfessionalPayoutAccount.stripeExpressStatus`: `NOT_STARTED` / `PENDING` / `READY`) — the existing Module 62 enum, now actually driven by real Stripe state.
- **Payout eligibility** (`isStripePayoutEligible` = `transfersActive && payoutsEnabled` — corrected post-audit from an originally-broken `chargesEnabled && payoutsEnabled` formula that was permanently `false`; see `docs/MODULE_71_STRIPE_CONNECT.md`) — read independently; an account can be `READY` today and lose payout eligibility tomorrow without its MaestroYa status changing.

## 3. Financial Flow

```
Labor:              €1,000
Materials:          €200
Full Presupuesto:   €1,200
MaestroYa (10%):    €120
Professional:       €1,080
```

This module introduces **no new commission math**. `COMMISSION_CALCULATION_SERVICE.calculate({ labour: 1000, materials: 200 })` (Module 64, unchanged) already returns `{ total: 1200, commission: 120, professionalPayout: 1080 }` — pinned by a new test (`tests/unit/core/domain/module-71-commission-compatibility.test.ts`). Stripe infrastructure never computes this number; it only ever executes a `Transfer` for an amount MaestroYa's own domain code already decided.

**Chosen Connect model: Express accounts + separate charges and transfers** (not destination charges, not Standard/Custom accounts):
- **Express**, not Standard/Custom: professionals need a hosted onboarding flow and dashboard MaestroYa doesn't build/maintain itself, but MaestroYa still wants to be the merchant of record — Express is Stripe's fit for this "managed platform" marketplace shape.
- **Separate charges + transfers**, not destination charges: the customer's payment is charged directly on the *platform's* Stripe account (`PaymentGateway`, Module 35/59 — unaffected by this module), and MaestroYa creates a `Transfer` of the professional's €1,080 share to their connected account only after `CommissionCalculationService` has determined it. **Primary reason (corrected post-audit):** MaestroYa's existing `payment-release-decision.ts` (Module 66 — Job Completion & Payment Release Protection) requires that a professional's payout be withheld until job-completion confirmation/dispute/trust checks pass *after* the customer has already paid. Destination charges credit the connected account's balance at charge time, giving MaestroYa no point to withhold the transfer pending that decision; Separate Charges and Transfers is the only Connect pattern where the `Transfer` is an independently-timed second API call, making it the only model compatible with Module 66's hold logic. Keeping MaestroYa as the party of record for refunds/disputes (so Module 68's `DisputeResolutionDecision` stays in control rather than Stripe's automatic Connect dispute-liability rules) is a real, useful property of this model, but it is secondary to the payment-capture/payout-release timing requirement above — see `docs/MODULE_71_STRIPE_CONNECT.md` for the full ADR.
- **Refunds**: happen against the platform's own charge; MaestroYa's existing `Refund`/`FinancialAdjustment` models are unaffected by this module and remain the source of truth for whether/how a professional's already-transferred share is clawed back — that reversal mechanism is Module 72/73's concern.
- **Disputes**: same reasoning — a chargeback lands on the platform's account, not the connected account, keeping MaestroYa (via `DisputeResolutionDecision`, Module 68) in control of the outcome rather than Stripe's automatic Connect dispute-liability rules.
- **Module 72 (Webhooks)**: `retrieveAccountStatus`/`GetStripeAccountStatusUseCase` already expose exactly the shape a future `account.updated` webhook handler needs; `findPayoutAccountByStripeAccountId` (new repository method) was added now specifically so that handler can look up a professional by Stripe account id without any repository-interface change.
- **Module 73 (VAT/Invoice)**: nothing here computes VAT or issues invoices. `CommissionCalculationService`'s `adjustments` extension point and `Commission.rateBps`/`Payment` models remain the integration surface; this module only prepares the payout-account side.

## 4. Changed Files

**New:**
- `src/core/domain/services/stripe-connect-account-rules.ts` — pure payout-eligibility/readiness rules.
- `src/core/application/ports/stripe-connect-gateway.ts` — the Stripe-free port.
- `src/core/infrastructure/payments/stripe/stripe-connect-gateway.ts` — Stripe SDK adapter + error mapping.
- `src/core/infrastructure/payments/stripe/compose.ts` — DI wiring for the adapter.
- `src/core/application/use-cases/stripe-connect/{create-stripe-connected-account,create-stripe-onboarding-link,get-stripe-account-status,create-stripe-login-link}.use-case.ts` + `compose.ts`.
- `prisma/migrations/20260902000000_add_stripe_connect_account_state/migration.sql`.
- Tests: `tests/unit/core/domain/stripe-connect-account-rules.test.ts`, `tests/unit/core/domain/module-71-commission-compatibility.test.ts`, `tests/unit/core/infrastructure/payments/stripe-connect-gateway.test.ts`, `tests/unit/core/application/use-cases/stripe-connect/{fakes,*.use-case.test}.ts`.

**Modified:**
- `src/core/domain/errors/domain-error.ts` — added `StripeConnectError`/`StripeConnectErrorCategory`.
- `src/core/domain/repositories/professional-onboarding-repository.ts` — extended `ProfessionalPayoutAccountRecord`, added `UpdateStripeConnectAccountData`, `findPayoutAccountByStripeAccountId`, `updateStripeConnectAccount`.
- `src/core/infrastructure/database/prisma/repositories/prisma-professional-onboarding-repository.ts` — implements the new fields/methods; `upsertPayoutAccount` now clears Stripe-mirrored fields when a professional switches away from `STRIPE_EXPRESS`.
- `prisma/schema.prisma` — 5 new columns on `ProfessionalPayoutAccount`; doc-comment updates only where they referenced "Module 65 (future)".
- `src/core/infrastructure/payout/stripe-express-payout-provider.ts`, `src/core/domain/services/professional-onboarding-rules.ts` — doc-comment updates reflecting that Module 71 now exists.
- `tests/unit/core/application/use-cases/onboarding/fakes.ts` — `FakeProfessionalOnboardingRepository` extended to satisfy the widened interface.

## 5. Database Changes

Purely additive: 5 new nullable/defaulted columns on the existing `professional_payout_accounts` table (`stripeChargesEnabled`, `stripePayoutsEnabled`, `stripeDetailsSubmitted`, `stripeRequirementsCurrentlyDue` — all `BOOLEAN NOT NULL DEFAULT false`; `stripeConnectSyncedAt` — nullable `TIMESTAMP`). No table renamed/dropped, no column removed, no backfill needed — every existing row's defaults are already correct ("no connected account yet"). No new table: `ProfessionalPayoutAccount` (Module 62) is reused as the canonical home for Stripe Connect state, per the repository's own reservation. The migration is hand-authored (no Postgres/Prisma-engine network access in this sandbox — see Testing), following the same precedent as `20260901000000_add_external_webhook_event_idempotency`.

## 6. Stripe Integration

`StripeConnectGatewayAdapter` implements 4 operations: `createConnectedAccount` (Express, `capabilities: transfers` only — corrected post-audit from an original `card_payments+transfers` request that was unnecessary under this Connect model, see `docs/MODULE_71_STRIPE_CONNECT.md`, Stripe-side idempotency key `connect-account:<professionalProfileId>`), `createOnboardingLink`, `retrieveAccountStatus`, `createLoginLink`. It performs zero business logic — no commission math, no eligibility decisions beyond passing Stripe's own flags through verbatim. `GetStripeAccountStatusUseCase` is the synchronization point: it reads Stripe, derives `READY`/`PENDING` via `deriveStripeExpressReadiness`, and writes the mirror — safe to call repeatedly (idempotent by construction, since it always just overwrites with Stripe's current answer).

## 7. Security

- Every use case resolves the acting professional via `ProfessionalRepository.findByUserId(userId)` — a caller can only create/inspect/link *their own* Stripe account, matching the existing `SetPayoutDestinationUseCase` authorization pattern exactly.
- No Stripe secret, account payload, or PII is ever logged by the adapter.
- `StripeConnectError` never exposes the raw Stripe SDK error to callers — only a category + message; the original is preserved on `.cause` for server-side observability only.
- `requirementsCurrentlyDue`/`disabledReason` (raw Stripe diagnostic strings) are surfaced only through the port/adapter layer for admin/observability use — the persisted domain state stores only a boolean (`stripeRequirementsCurrentlyDue`), never the raw requirement list.
- No new environment variables were needed — reused the existing `STRIPE_SECRET_KEY`/`STRIPE_PUBLISHABLE_KEY`/`STRIPE_WEBHOOK_SECRET` already validated by `env.ts`.

## 8. Idempotency

Implemented: (1) Stripe-side idempotency key on `accounts.create`, deterministic per `professionalProfileId`; (2) application-level idempotency in `CreateStripeConnectedAccountUseCase` — if `stripeExpressAccountId` is already set, the use case returns the existing record without calling Stripe again (tested — see below). `GetStripeAccountStatusUseCase` is naturally idempotent (always overwrites with Stripe's current truth). Remaining for Module 72: webhook-delivery idempotency (duplicate `account.updated` events) — the existing `ExternalWebhookEventRepository` (Module 70.1) is the mechanism that module should reuse, unchanged by this one.

## 9. Testing

- `npx tsc --noEmit` — **PASS** (0 errors).
- `npx eslint` on all new/changed files — **PASS** (0 errors).
- `npx vitest run` on all new tests (domain rules, commission compatibility, adapter, 4 use cases) — **37/37 PASS**.
- Regression check — `tests/unit/core/application/use-cases/onboarding/**`, `tests/unit/core/infrastructure/{onboarding,payout}/**`, `tests/unit/core/domain/{professional-onboarding-rules,commission-calculation-service}.test.ts`, `tests/integration/{onboarding,professional/onboarding-flows,financial/payout-readiness-flows}` — **all still passing** (no behavior changed for existing IBAN/onboarding flows).
- `npx prisma validate` — **could not run**: this sandboxed device shell has no network access, and no `linux-arm64` Prisma schema-engine binary is cached locally (only `darwin-arm64` is present). The schema change itself is a straightforward 5-column additive `ALTER TABLE`, hand-verified against Prisma syntax and the existing model's conventions. Recommend running `npm run prisma:generate` (or `prisma validate`) once on a machine with network access before deploying.
- No integration tests against real Stripe were added — per the module brief, only mocked Stripe SDK behavior was used; no real credentials appear anywhere in the test suite.

## 10. Remaining Work

**Module 71 — completed:** connected-account creation, onboarding-link generation, account-status synchronization, dashboard login link, persistence, DI wiring, error handling, idempotency (account-creation level), documentation of the Connect model choice.

**Module 72 — Stripe Webhooks (not started):** an `account.updated`/`account.application.deauthorized` webhook route, signature verification (mirroring `PersonaVerificationProvider.webhookValidation`'s pattern), and using `ExternalWebhookEventRepository` + `findPayoutAccountByStripeAccountId` (added in this module specifically to support it) to reconcile state without polling.

**Module 73 — VAT & Invoice Integration (not started):** no VAT calculation, no invoice generation, no Spain-specific tax logic was added. `CommissionCalculationService`'s `adjustments` extension point remains the intended integration surface.
