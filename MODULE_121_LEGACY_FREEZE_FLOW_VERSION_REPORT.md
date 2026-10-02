# Module 121 — Legacy Freeze & Flow Version Boundary — REPORT

Companion to `MODULE_121_LEGACY_FREEZE_FLOW_VERSION_AUDIT.md` (full call-graph analysis, design rationale, risks).

## Summary
A persisted `ServiceRequest.flowVersion` (`LEGACY_QUOTE_PAYMENT` default | `LEAD_V1`) plus one `TransactionFlowGuard` now stands in front of every legacy money-moving entry point (quote create/accept, PaymentIntent authorize, capture + `PaymentCaptured`, Commission + ledger, release evaluation/admin resolution, Stripe Connect payout, self-billed invoice / customer receipt, affiliate conversion). A LEAD_V1 request gets a `LegacyFlowBoundaryError` (use cases) or a logged no-op (webhook / event subscribers). LEGACY behaviour is unchanged (default value, guard passes). Additive migration only; no legal docs, no Lead/LeadPurchase/LeadFee/Pricing/Feed code.

## Verification
Test runs (Vitest, on your machine's connected folder, in slices because the sandbox kills runs > ~3 min):

| Slice | Result |
|---|---|
| tests/integration | 71 files / 1010 tests passed |
| tests/unit/core/domain | 132 / 1289 passed |
| tests/unit/core/application (incl. payments, reconciliation, invoicing, affiliate, refunds, **new flow-boundary**) | 146 / 1083 passed |
| tests/unit/core/infrastructure | 163 / 1263 passed |
| tests/unit/app | 37 / 212 passed |
| tests/unit/presentation | 58 / 412 passed |
| tests/unit/shared, i18n, regression | 20/185, 1/1, 1/9 passed |
| tests/unit/prisma (incl. **new contract test**) + middleware/next.config/prisma_probe | all passed |

New tests: 14 (behavioural boundary) + 12 (schema/migration/composition contract). Not run: Playwright e2e and `test:integration:db` (need a browser / real Postgres). I ran the suite in slices rather than a single `npm test` invocation; the union covers every test directory.

Environment caveats (not caused by this module): the sandbox VM has no Prisma query engine (403 from binaries.prisma.sh), so `vitest` prints `PrismaClientInitializationError` "unhandled rejection/error" lines from tests that import real Prisma repositories (present in `prisma_probe.test.ts` and integration/app/infra slices) and exits non-zero even though every test passes. Please re-run `npm test` on your Mac where the engine exists to confirm a clean exit code.

`npx tsc --noEmit`: 2 errors, both `flowVersion` not existing on the **stale generated Prisma client** in `prisma-transaction-flow-reader.ts`. They disappear after `npx prisma generate` (which I could not run here). No other type errors.

## Required actions before merging (yours)
1. `npx prisma generate` then `npm run typecheck` (expect 0 errors).
2. Apply migration `20260930000000_add_module_121_transaction_flow_version` to a staging DB (`prisma migrate deploy`); optionally `prisma migrate diff` to confirm no drift vs. the hand-authored SQL.
3. `npm test` locally for a clean exit code.
4. Review, `git add`/commit yourself (nothing was staged). Untracked pre-existing items (`.probe-prof/`, `Claude outputs/`, `legal/`) were not touched.

## KEEP / ADAPT / FREEZE / REMOVE LATER

Nothing is classified REMOVE now. Financial history must stay readable for accounting/audit.

| Component | Class | Notes |
|---|---|---|
| `Payment`, `Commission`, `Payout`, `Refund`, `Transaction`, `FinancialAdjustment`, ledger, `Invoice`, `CreditNote`, `SelfBillingAuthorization`, reconciliation tables, `StripeDispute` | **KEEP** (FREEZE for new business) | Historical/accounting data; retention obligations. Read paths unchanged. |
| `InitiateQuotePaymentUseCase`, `ProcessCustomerPaymentWebhookUseCase` capture path | **FREEZE** | Guarded; legacy only. |
| `RecordCommissionForPayment`, `CalculateJobCommissionBreakdown`, `CommissionCalculationService`, `commission-policy` | **FREEZE** | Not to be reused as Lead Fee. |
| `EvaluatePaymentRelease`, `AdminResolvePaymentRelease`, `JobCompletionConfirmation.release*` | **FREEZE** | Guarded. |
| `ExecuteProfessionalPayout`, `ReverseProfessionalPayout`, payout eligibility gate for customer jobs | **FREEZE** — **REMOVE LATER (candidate)** | Only after all legacy jobs settled + retention review. |
| Self-billing / customer receipt creation + invoice lifecycle subscriber | **FREEZE** | Guarded; invoice storage/read stays. |
| Refund, Stripe dispute, credit-note subscribers, reconciliation engine | **KEEP** | Operate on existing legacy Payments; unchanged. |
| `CreateQuote`, `AcceptQuote`, Quote/Job models | **FREEZE** | Guarded; LEAD_V1 must not use them. |
| Affiliate conversion on `PaymentReleaseApproved` | **FREEZE** | Guarded; new lead-fee-based reward = new subscriber (Module 122+). |
| Affiliate partner payouts (`CreatePartnerPayout`, `transferGateway` usage) | **KEEP / ADAPT** | Not part of the customer-payment flow; ADAPT when reward basis moves to lead-fee revenue. |
| Stripe client, webhook verifier, `ExternalWebhookEvent` idempotency, `DistributedLock`, feature flags | **KEEP** (reusable infra) | |
| Stripe Connect account onboarding / KYC / payout-destination readiness | **KEEP** | Reusable for verifying professionals; retire only if Connect is dropped entirely. |
| `PaymentGateway` / PaymentIntent plumbing | **ADAPT** (candidate) | Possible base for the Lead Fee charge; needs a separate payer/purpose/idempotency namespace. |
| Legacy domain events (`PaymentCaptured`, `PaymentReleaseApproved/Held`, `ProfessionalPayout*`, `Invoice*`, `CreditNote*`, `PaymentRefunded`, `StripeDispute*`) | **KEEP / FREEZE** | Not renamed or deleted. |
| **New:** `ServiceRequest.flowVersion`, `TransactionFlowGuard`, `LegacyFlowBoundaryError` | **KEEP** | The boundary itself. Module 122 should make the guard a required dependency. |
| `GetAvailableServiceRequestsForProfessional` (quote feed) | **ADAPT (Module 122)** | Must exclude LEAD_V1 once requests can be LEAD_V1. |

## Exit criteria
- [x] Legacy flow identified · [x] routing boundary exists · [x] LEAD_V1 blocked from payment / commission / release / payout / Stripe Connect payout / customer-payment invoicing · [x] legacy default + history untouched · [x] events separated (publisher + consumer side) · [x] tests prove the boundary · [x] no destructive DB operation (none run at all) · [x] no legal docs / Lead marketplace features · [x] audit + report created · [x] Module 122 prerequisites listed (audit §15)
- [ ] `npm test` clean exit code and typecheck: pending your local `prisma generate` (see above); every test passed in my runs.

Stopped after Module 121 as instructed.
