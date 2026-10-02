# Module 121 — Legacy Freeze & Flow Version Boundary — AUDIT

Status: implemented, awaiting your review. No `git add/commit/push/reset/restore` was run. No legal documents, Lead entity, LeadPurchase, Pricing Engine, Lead Feed or Lead Fee code was added.

## 1. Existing flow discovered

There was **no** flow/version concept anywhere (grep for `flowVersion|LEAD_V1|LEGACY_QUOTE` over `src/`, `prisma/`, `tests/` returned nothing). The legacy financial chain is anchored on `ServiceRequest`:

```
ServiceRequest -> Quote (CreateQuote) -> AcceptQuote -> Job
  -> InitiateQuotePayment (PaymentIntent, Payment row)
  -> Stripe webhook: capture -> PaymentCaptured
  -> Job complete -> JobCompletionConfirmation -> EvaluatePaymentRelease -> PaymentReleaseApproved / Held
  -> RecordCommissionForPayment (Commission + ledger: LABOR_CHARGE, COMMISSION, PROFESSIONAL_NET_EARNING, PLATFORM_REVENUE)
  -> ExecuteProfessionalPayout (Stripe Connect transfer, Payout row) -> ProfessionalPayoutExecuted
  -> invoicing: professional self-billed invoice + customer receipt
  -> affiliate conversion / affiliate commission
```

`Job.quoteId` is required and unique and `Payment.serviceRequestId` is required, so **every** legacy financial record is reachable from a `ServiceRequest` id.

## 2. Legacy financial entry points (traced through call graph)

| # | Entry point | Side effect |
|---|---|---|
| 1 | `CreateQuoteUseCase` | Quote (door into Job/Payment) |
| 2 | `AcceptQuoteUseCase` (-> `QuoteAcceptanceRepository`) | Job creation |
| 3 | `InitiateQuotePaymentUseCase` | `paymentGateway.authorize` (Stripe PaymentIntent) + Payment row |
| 4 | `ProcessCustomerPaymentWebhookUseCase` (`amount_capturable_updated`, `succeeded`) | `paymentGateway.capture`, Payment -> CAPTURED, `PaymentCaptured` |
| 5 | `RecordCommissionForPaymentUseCase` (also called by payout use case + affiliate subscriber + `RecordCommissionOnPaymentCapturedSubscriber`) | Commission row + 5 ledger entries |
| 6 | `EvaluatePaymentReleaseUseCase`, `AdminResolvePaymentReleaseUseCase` | `updateReleaseDecision`, `PaymentReleaseApproved/Held` |
| 7 | `ExecuteProfessionalPayoutUseCase` (+ `ExecutePayoutOnReleaseApprovedSubscriber`) | Stripe Connect `transfers.create`, Payout row |
| 8 | `CreateProfessionalInvoiceDraftUseCase`, `CreateCustomerReceiptDraftUseCase` (+ `ActivateInvoiceLifecycleOnPaymentReleaseApprovedSubscriber`) | self-billed invoice / receipt |
| 9 | `RecordAffiliateConversionOnPaymentReleaseApprovedSubscriber` | conversion + affiliate commission derived from legacy Commission |

Only these use cases call `paymentGateway.authorize/capture`, `transferGateway.createTransfer` (for customer jobs), `commissions.create`, `confirmations.updateReleaseDecision` (verified by grep over `src/`). `create/reverse` credit-note, refund and Stripe-dispute flows operate on an already-existing legacy Payment and are therefore unreachable for a request that can never obtain a Payment.

## 3. Mechanism selected

Smallest architecture-consistent option: **persist the flow on `ServiceRequest`** and enforce it with **one guard at the legacy entry points**.

* `prisma/schema.prisma`: `enum TransactionFlowVersion { LEGACY_QUOTE_PAYMENT LEAD_V1 }` and `ServiceRequest.flowVersion TransactionFlowVersion @default(LEGACY_QUOTE_PAYMENT)`.
* `domain/services/transaction-flow.ts`: type, default, `LegacyFlowBoundaryError` (own error class, deliberately **not** a `ValidationError`, so no existing "not ready yet, defer" catch block can silently swallow it as a soft condition), and the list of guarded operation names.
* `application/ports/transaction-flow-reader.ts` + `infrastructure/database/prisma/repositories/prisma-transaction-flow-reader.ts`: narrow read port (a one-column `select`) — chosen over adding a method to the widely-faked `ServiceRequestRepository`.
* `application/services/flow/transaction-flow-guard.ts`: `TransactionFlowGuard.assertLegacy(serviceRequestId, operation)` (fails **closed** on any non-legacy/unknown value, logs `legacy_flow_boundary.blocked` with ids only) and `shouldRunLegacyFlow` for non-throwing callers (webhook).
* `application/services/flow/compose.ts`: shared singleton used by composition roots.

Why not reuse an existing field: nothing existing distinguishes the models (`Payment.method`, `Quote`, `Job` are all legacy-shaped); a Job/Payment-level flag would be too late, because a lead request has neither Quote nor Job. Why on `ServiceRequest`: it is the common ancestor of Quote/Job/Payment and is where Module 122's Lead will originate.

## 4/5. Files changed and why

New: `domain/services/transaction-flow.ts`, `application/ports/transaction-flow-reader.ts`, `application/services/flow/{transaction-flow-guard,compose}.ts`, `infrastructure/database/prisma/repositories/prisma-transaction-flow-reader.ts`, migration `20260930000000_add_module_121_transaction_flow_version`, two test files.

Modified (each: one optional trailing constructor param `flowGuard?: TransactionFlowGuard` + one `await this.flowGuard?.assertLegacy(...)` line right after the entity is loaded): `create-quote`, `accept-quote`, `initiate-quote-payment`, `process-customer-payment-webhook` (uses `shouldRunLegacyFlow`, returns `ignored` so Stripe is still ACKed), `record-commission-for-payment`, `evaluate-payment-release`, `admin-resolve-payment-release`, `execute-professional-payout`, `create-professional-invoice-draft`, `create-customer-receipt-draft`.
Subscribers (catch `LegacyFlowBoundaryError`, log at `info`, return): commission-on-capture, payout-on-release, invoice-lifecycle-on-release (added to `isExpectedNonActivation`), affiliate-conversion-on-release.
Composition roots (inject `transactionFlowGuard`): quotes, payments, financial, job, invoicing `compose.ts`.
`schema.prisma`: enum + column.

The parameter is optional to follow this repo's own convention for late-added dependencies (every historical direct-construction in tests keeps compiling/behaving identically). The fail-open risk that creates is closed by `tests/unit/prisma/transaction-flow-boundary-contract.test.ts`, which asserts every production `make*` factory passes `transactionFlowGuard`.

## 6. Legacy paths protected
For `LEGACY_QUOTE_PAYMENT` (the column default, so every existing row) the guard is a single read that passes; no other line of legacy logic was changed. No use case signature changed in a breaking way (trailing optional params only). No event renamed/removed.

## 7. LEAD_V1 blocked from
Quote creation/acceptance (=> no Job), PaymentIntent authorize, capture + `PaymentCaptured`, Commission + ledger, release evaluation/admin resolution + `PaymentReleaseApproved/Held`, payout + Stripe Connect transfer + `ProfessionalPayout*` events, self-billed invoice + customer receipt, affiliate conversion from a legacy commission. Blocked **defence-in-depth**: subscribers are guarded transitively through the use cases they call, so a stray legacy event for a LEAD_V1 request is a logged no-op.

## 8. Stripe boundary
* Legacy-only: `StripePaymentGateway.authorize/capture`, `InitiateQuotePayment`, `ProcessCustomerPaymentWebhook` capture path, `StripeTransferGateway.createTransfer/reverseTransfer` for customer jobs, `ExecuteProfessionalPayout`, `ReverseProfessionalPayout`, `ExecuteRefund`, Stripe dispute -> financial adjustment path.
* Reusable infrastructure: Stripe client (`stripe/client.ts`), webhook signature verifier + `ExternalWebhookEvent` idempotent claim table, `DistributedLock`, `StripeConnect` account onboarding (professional onboarding/KYC/IBAN readiness), `StripeTransferGateway` (also used by *affiliate partner payouts* — untouched).
* Potentially reusable later: `PaymentGateway`/PaymentIntent plumbing and webhook handling for the Lead Fee charge (a Lead Fee is charged to the professional, a different payer/amount/purpose — Module 122+ decides; do **not** call `InitiateQuotePayment`).
* Candidates for eventual removal (only once legacy jobs are all settled and accounting retention permits): Connect transfer/payout path for customer jobs.

## 9. Commission boundary
`Commission`, `CommissionCalculationService`, `commission-policy`, ledger types `COMMISSION`/`PLATFORM_REVENUE` remain legacy-only. Not renamed. `RecordCommissionForPaymentUseCase` is the single chokepoint (also reached from payout and affiliate paths) and is guarded. Future Lead Fee must be a new concept/table.

## 10. Event boundary
Legacy-only events (untouched, undeleted): `PaymentCaptured`, `PaymentReleaseApproved`, `PaymentReleaseHeld`, `PaymentRefunded`, `RefundFailed`, `ProfessionalPayoutExecuted/Failed/Reversed`, `PayoutReversalFailed`, `InvoiceCreated/Issued/Paid/...`, `CreditNote*`, `StripeDispute*`, `SelfBillingAuthorizationGranted`. **Publisher side:** the publishing use cases (`markCaptured`, `EvaluatePaymentRelease`, `AdminResolve…`, `ExecuteProfessionalPayout`, invoice drafts) are guarded before any publish. **Consumer side:** the four release/capture subscribers no-op for non-legacy. Not covered by a subscriber-level guard: credit-note-on-refund / stripe-dispute subscribers and the reconciliation subscribers (they act on an existing Payment, which LEAD_V1 cannot have).

## 11. Data migration safety
`20260930000000_add_module_121_transaction_flow_version`: `CREATE TYPE` + `ALTER TABLE service_requests ADD COLUMN "flowVersion" ... NOT NULL DEFAULT 'LEGACY_QUOTE_PAYMENT'`. Additive, constant default (metadata-only on PostgreSQL 11+, no table rewrite/long lock), backfills nothing, drops/updates nothing; old application code keeps working against the new column (ignored) and new code against the old column is not possible before migrate. Rollback = drop column + drop type. A static test asserts the SQL has no `DROP/DELETE/TRUNCATE/UPDATE/RENAME`. No database command was run.

## 12. Tests added
`tests/unit/core/application/use-cases/flow-boundary/legacy-flow-boundary.test.ts` (14 tests) and `tests/unit/prisma/transaction-flow-boundary-contract.test.ts` (12 tests). Mapping to the brief: T1 initiate payment (+quote accept, +webhook capture); T2 commission; T3 release (evaluate + admin); T4/T5 payout + Stripe transfer (`transfers.calls === 0`); T6 both invoice drafts + subscriber; T7 legacy payment initiation with guard; T8 schema default/additive migration contract (existing records default legacy; no data statements); T9 existing reconciliation/reporting suites run in the full run; T10 repeated webhook delivery = one capture, one `PaymentCaptured`, and repeated LEAD_V1 delivery = zero captures/events. Dependencies not expected to be touched are `tripwire` proxies that throw on any call.

## 13. Tests executed
See the report file (`MODULE_121_LEGACY_FREEZE_FLOW_VERSION_REPORT.md`) for the exact results.

## 14. Remaining risks
1. **`prisma generate` and `prisma migrate deploy` must be run by you** — the sandbox has no Prisma engine (403 from binaries.prisma.sh), so I could not regenerate the client or apply/validate the migration. Until `prisma generate` runs, `tsc` reports 2 expected errors in `prisma-transaction-flow-reader.ts` (`flowVersion` unknown on the stale client). The SQL is hand-authored like earlier migrations; validate with `prisma migrate diff`/`migrate deploy` on staging.
2. Nothing sets `flowVersion = LEAD_V1` yet (deliberate). Request creation still always yields legacy.
3. Guard is optional in constructors: any *new* construction site that omits it fails open. Mitigated by the wiring contract test for existing sites; Module 122 should make it required or extend that test.
4. Not guarded (act only on an existing Payment/Job, unreachable for LEAD_V1 by construction): refund, payout reversal, credit notes, Stripe dispute handlers, reconciliation. Also `JobCompletion`/`Job.complete` (need a Job). If a future module ever creates a `Job`/`Payment` for a lead request, extend the guard to these.
5. Discovery: `GetAvailableServiceRequestsForProfessional` (the legacy "quote on this request" feed) does not yet filter out LEAD_V1 requests — irrelevant until requests can be LEAD_V1, but must be done in Module 122 (otherwise LEAD_V1 requests would be listed but un-quotable).
6. `Payment` webhook `refund`/`failed`/`cancelled`/dispute branches are intentionally not flow-checked.

## 15. Follow-up for Module 122 (prerequisites)
1. Apply/verify the migration, run `prisma generate`, run typecheck (expect 0 errors).
2. Decide how a ServiceRequest becomes LEAD_V1 (creation-time choice / market or feature-flag config) and set `flowVersion` explicitly there; add it to `ServiceRequestRecord`/admin DTOs.
3. Exclude LEAD_V1 requests from the legacy quote discovery feed; legacy customer UI for quotes/payments must not be shown for them.
4. Introduce Lead/LeadPurchase/LeadFee as **new** tables and use cases; never call the guarded legacy use cases. Consider making `flowGuard` a required dependency then.
5. Decide reuse of Stripe PaymentIntent/webhook plumbing for the Lead Fee (separate payer, purpose and idempotency-key namespace, e.g. `lead-fee:<leadPurchaseId>`), with a separate webhook outcome path so it never hits `ProcessCustomerPaymentWebhook`'s legacy `Payment` lookups.
6. New invoicing for lead fees (MaestroYa -> professional invoice) is separate from the legacy self-billing; confirm tax treatment with the Spanish advisor.
7. Affiliate rewards from lead-fee revenue: new event/subscriber; the legacy `RecordAffiliateConversion…OnPaymentReleaseApproved` stays legacy-only.
