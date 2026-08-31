import "server-only";

import { eventBus } from "@/infrastructure/events/compose";
import { createFailureReporter } from "@/infrastructure/observability/failure-reporter-factory";
import { PrismaJobRepository } from "@/infrastructure/database/prisma/repositories/prisma-job-repository";
import { PrismaPaymentRepository } from "@/infrastructure/database/prisma/repositories/prisma-payment-repository";
import { PrismaQuoteRepository } from "@/infrastructure/database/prisma/repositories/prisma-quote-repository";
import { PrismaProfessionalRepository } from "@/infrastructure/database/prisma/repositories/prisma-professional-repository";
import { PrismaCompanyRepository } from "@/infrastructure/database/prisma/repositories/prisma-company-repository";
import { PrismaCommissionRateRepository } from "@/infrastructure/database/prisma/repositories/prisma-commission-rate-repository";
import { PrismaSelfBillingAuthorizationRepository } from "@/infrastructure/database/prisma/repositories/prisma-self-billing-authorization-repository";
import { PrismaInvoiceRepository } from "@/infrastructure/database/prisma/repositories/prisma-invoice-repository";
import { PrismaCreditNoteRepository } from "@/infrastructure/database/prisma/repositories/prisma-credit-note-repository";
import { PrismaAdminAuditLogRepository } from "@/infrastructure/database/prisma/repositories/prisma-admin-audit-log-repository";
import { PrismaCustomerProfileRepository } from "@/infrastructure/database/prisma/repositories/prisma-customer-profile-repository";
import { PrismaUserRepository } from "@/infrastructure/database/prisma/repositories/prisma-user-repository";
import { CalculateJobTaxBreakdownUseCase } from "@/application/use-cases/financial/calculate-job-tax-breakdown.use-case";
import { GrantSelfBillingAuthorizationUseCase } from "./grant-self-billing-authorization.use-case";
import { RevokeSelfBillingAuthorizationUseCase } from "./revoke-self-billing-authorization.use-case";
import { CreateProfessionalInvoiceDraftUseCase } from "./create-professional-invoice-draft.use-case";
import { CreateCustomerReceiptDraftUseCase } from "./create-customer-receipt-draft.use-case";
import { SubmitInvoiceForAcceptanceUseCase } from "./submit-invoice-for-acceptance.use-case";
import { AcceptInvoiceUseCase } from "./accept-invoice.use-case";
import { IssueInvoiceUseCase } from "./issue-invoice.use-case";
import { MarkInvoicePaidUseCase } from "./mark-invoice-paid.use-case";
import { CancelInvoiceUseCase } from "./cancel-invoice.use-case";
import { MarkInvoicePaidOnPayoutExecutedSubscriber } from "./mark-invoice-paid-on-payout-executed.subscriber";
import { ActivateInvoiceLifecycleOnPaymentReleaseApprovedSubscriber } from "./activate-invoice-lifecycle-on-payment-release-approved.subscriber";
import { CreateCreditNoteOnPaymentRefundedSubscriber } from "./create-credit-note-on-payment-refunded.subscriber";
import { CreateCreditNoteOnStripeDisputeLostSubscriber } from "./create-credit-note-on-stripe-dispute-lost.subscriber";
import { CreateCreditNoteUseCase } from "./create-credit-note.use-case";
import { CheckInvoiceRequiredForPayoutUseCase } from "./check-invoice-required-for-payout.use-case";
import {
  RecordInvoiceAuditLogSubscriber,
  RecordSelfBillingAuditLogSubscriber,
  RecordCreditNoteAuditLogSubscriber,
} from "./record-invoicing-audit-log.subscriber";
import { SelfBillingAuthorizationGranted } from "@/domain/events/self-billing-authorization-granted";
import { InvoiceCreated } from "@/domain/events/invoice-created";
import { InvoiceSubmittedForAcceptance } from "@/domain/events/invoice-submitted-for-acceptance";
import { InvoiceAccepted } from "@/domain/events/invoice-accepted";
import { InvoiceIssued } from "@/domain/events/invoice-issued";
import { InvoicePaid } from "@/domain/events/invoice-paid";
import { InvoiceCancelled } from "@/domain/events/invoice-cancelled";
import { CreditNoteCreated } from "@/domain/events/credit-note-created";
import { CreditNoteIssued } from "@/domain/events/credit-note-issued";
import { ProfessionalPayoutExecuted } from "@/domain/events/professional-payout-executed";
import { PaymentReleaseApproved } from "@/domain/events/payment-release-approved";
import { PaymentRefunded } from "@/domain/events/payment-refunded";
import { StripeDisputeClosed } from "@/domain/events/stripe-dispute-closed";

/**
 * Module 79 — Invoicing & Credit Notes: composition root, same manual-
 * composition convention as every other `compose.ts` in this codebase.
 * Also this module's `eventBus.subscribe` registration point — reuses
 * Module 76's own `ProfessionalPayoutExecuted` event (never modifies
 * `payments/compose.ts`'s own registrations) to mark an invoice PAID, and
 * records every Module 79 lifecycle event to the existing admin audit log
 * (see `record-invoicing-audit-log.subscriber.ts`).
 */
const jobs = new PrismaJobRepository();
const payments = new PrismaPaymentRepository();
const quotes = new PrismaQuoteRepository();
const professionals = new PrismaProfessionalRepository();
const companies = new PrismaCompanyRepository();
const rates = new PrismaCommissionRateRepository();
const selfBillingAuthorizations = new PrismaSelfBillingAuthorizationRepository();
const invoices = new PrismaInvoiceRepository();
const creditNotes = new PrismaCreditNoteRepository();
const customerProfiles = new PrismaCustomerProfileRepository();
const users = new PrismaUserRepository();
const auditLog = new PrismaAdminAuditLogRepository();
const failureReporter = createFailureReporter();

// Reuses Module 78's own use case rather than constructing a second
// instance with different dependencies — see this file's own doc
// comment and CalculateJobTaxBreakdownUseCase's own doc comment on why
// this is the one place both a professional's and (eventually) a
// customer's invoice figures are derived from.
const taxBreakdowns = new CalculateJobTaxBreakdownUseCase(jobs, quotes, rates);

export function makeGrantSelfBillingAuthorizationUseCase(): GrantSelfBillingAuthorizationUseCase {
  return new GrantSelfBillingAuthorizationUseCase(selfBillingAuthorizations, eventBus, failureReporter);
}

export function makeRevokeSelfBillingAuthorizationUseCase(): RevokeSelfBillingAuthorizationUseCase {
  return new RevokeSelfBillingAuthorizationUseCase(selfBillingAuthorizations);
}

export function makeCreateProfessionalInvoiceDraftUseCase(): CreateProfessionalInvoiceDraftUseCase {
  return new CreateProfessionalInvoiceDraftUseCase(
    jobs,
    payments,
    quotes,
    professionals,
    companies,
    selfBillingAuthorizations,
    invoices,
    taxBreakdowns,
    eventBus,
    failureReporter,
  );
}

export function makeCreateCustomerReceiptDraftUseCase(): CreateCustomerReceiptDraftUseCase {
  return new CreateCustomerReceiptDraftUseCase(
    jobs,
    payments,
    quotes,
    customerProfiles,
    users,
    invoices,
    taxBreakdowns,
    eventBus,
    failureReporter,
  );
}

export function makeSubmitInvoiceForAcceptanceUseCase(): SubmitInvoiceForAcceptanceUseCase {
  return new SubmitInvoiceForAcceptanceUseCase(invoices, eventBus, failureReporter);
}

export function makeAcceptInvoiceUseCase(): AcceptInvoiceUseCase {
  return new AcceptInvoiceUseCase(invoices, professionals, companies, selfBillingAuthorizations, eventBus, failureReporter);
}

export function makeIssueInvoiceUseCase(): IssueInvoiceUseCase {
  return new IssueInvoiceUseCase(invoices, eventBus, failureReporter);
}

export function makeMarkInvoicePaidUseCase(): MarkInvoicePaidUseCase {
  return new MarkInvoicePaidUseCase(invoices, eventBus, failureReporter);
}

export function makeCancelInvoiceUseCase(): CancelInvoiceUseCase {
  return new CancelInvoiceUseCase(invoices, eventBus, failureReporter);
}

export function makeCreateCreditNoteUseCase(): CreateCreditNoteUseCase {
  return new CreateCreditNoteUseCase(invoices, creditNotes, taxBreakdowns, eventBus, failureReporter);
}

/** Module 76 integration point — see
 *  `ExecuteProfessionalPayoutUseCase`'s own updated constructor doc
 *  comment. `payments/compose.ts` imports and wires this. */
export function makeCheckInvoiceRequiredForPayoutUseCase(): CheckInvoiceRequiredForPayoutUseCase {
  return new CheckInvoiceRequiredForPayoutUseCase(invoices);
}

eventBus.subscribe(ProfessionalPayoutExecuted, new MarkInvoicePaidOnPayoutExecutedSubscriber(makeMarkInvoicePaidUseCase()));

// Module 85 — Invoicing & Credit Note Activation: the activation this
// module exists to add — see
// `ActivateInvoiceLifecycleOnPaymentReleaseApprovedSubscriber`'s own doc
// comment for why `PaymentReleaseApproved` (Module 66) is the right
// trigger point and why the full draft -> submit -> accept -> issue (and
// customer-receipt draft -> issue) pipeline runs from here rather than
// leaving any step for a manual call that, per this module's own audit,
// nothing ever made.
eventBus.subscribe(
  PaymentReleaseApproved,
  new ActivateInvoiceLifecycleOnPaymentReleaseApprovedSubscriber(
    invoices,
    professionals,
    companies,
    makeCreateProfessionalInvoiceDraftUseCase(),
    makeSubmitInvoiceForAcceptanceUseCase(),
    makeAcceptInvoiceUseCase(),
    makeIssueInvoiceUseCase(),
    makeCreateCustomerReceiptDraftUseCase(),
    failureReporter,
  ),
);

// Module 85 — Invoicing & Credit Note Activation: wires
// `CreateCreditNoteUseCase` into Module 77's own `PaymentRefunded` — see
// `CreateCreditNoteOnPaymentRefundedSubscriber`'s own doc comment.
eventBus.subscribe(
  PaymentRefunded,
  new CreateCreditNoteOnPaymentRefundedSubscriber(invoices, creditNotes, taxBreakdowns, makeCreateCreditNoteUseCase(), failureReporter),
);

// Module 86 — Stripe Chargeback & Dispute Handling: same integration,
// wired to `ProcessStripeDisputeWebhookUseCase`'s own `StripeDisputeClosed`
// (LOST outcome only) instead — see
// `CreateCreditNoteOnStripeDisputeLostSubscriber`'s own doc comment.
eventBus.subscribe(
  StripeDisputeClosed,
  new CreateCreditNoteOnStripeDisputeLostSubscriber(invoices, creditNotes, taxBreakdowns, makeCreateCreditNoteUseCase(), failureReporter),
);

eventBus.subscribe(SelfBillingAuthorizationGranted, new RecordSelfBillingAuditLogSubscriber(auditLog));
eventBus.subscribe(InvoiceCreated, new RecordInvoiceAuditLogSubscriber(auditLog));
eventBus.subscribe(InvoiceSubmittedForAcceptance, new RecordInvoiceAuditLogSubscriber(auditLog));
eventBus.subscribe(InvoiceAccepted, new RecordInvoiceAuditLogSubscriber(auditLog));
eventBus.subscribe(InvoiceIssued, new RecordInvoiceAuditLogSubscriber(auditLog));
eventBus.subscribe(InvoicePaid, new RecordInvoiceAuditLogSubscriber(auditLog));
eventBus.subscribe(InvoiceCancelled, new RecordInvoiceAuditLogSubscriber(auditLog));
eventBus.subscribe(CreditNoteCreated, new RecordCreditNoteAuditLogSubscriber(auditLog));
eventBus.subscribe(CreditNoteIssued, new RecordCreditNoteAuditLogSubscriber(auditLog));
