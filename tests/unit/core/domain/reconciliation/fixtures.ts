import type { CommissionRecord } from "@/domain/repositories/commission-repository";
import type { CreditNoteRecord } from "@/domain/repositories/credit-note-repository";
import type { InvoiceRecord } from "@/domain/repositories/invoice-repository";
import type { PaymentRecord } from "@/domain/repositories/payment-repository";
import type { PayoutRecord } from "@/domain/repositories/payout-repository";
import type { RefundRecord } from "@/domain/repositories/refund-repository";
import type { JobFinancialContext } from "@/domain/services/reconciliation/context";
import type { JobCommissionBreakdownResult } from "@/application/use-cases/financial/calculate-job-commission-breakdown.use-case";
import type { JobTaxBreakdownResult } from "@/application/use-cases/financial/calculate-job-tax-breakdown.use-case";

/**
 * Module 80 — Financial Reconciliation & Observability: shared,
 * hand-built fixtures for the reconciliation check unit tests. Every
 * default value below represents a perfectly consistent, clean job — a
 * job commission of 10% on a 1000 EUR total (100 commission, 900
 * professional net), matching Module 64's DEFAULT_COMMISSION_RATE_BPS.
 * Tests mutate a single field per case to introduce exactly one
 * inconsistency at a time.
 */

export function makePayment(overrides: Partial<PaymentRecord> = {}): PaymentRecord {
  return {
    id: "payment-1",
    serviceRequestId: "service-request-1",
    quoteId: "quote-1",
    jobId: "job-1",
    payerId: "user-customer-1",
    amount: 1000,
    currency: "EUR",
    status: "CAPTURED",
    capturedAt: new Date("2026-01-01T00:00:00Z"),
    stripePaymentIntentId: "pi_test_1",
    method: "CARD",
    failureReason: null,
    ...overrides,
  };
}

export function makeCommission(overrides: Partial<CommissionRecord> = {}): CommissionRecord {
  return {
    id: "commission-1",
    paymentId: "payment-1",
    professionalProfileId: "professional-1",
    companyProfileId: null,
    rateBps: 1000,
    amount: 100,
    status: "PENDING",
    settledAt: null,
    createdAt: new Date("2026-01-01T00:00:00Z"),
    ...overrides,
  };
}

export function makeCommissionBreakdown(overrides: Partial<JobCommissionBreakdownResult> = {}): JobCommissionBreakdownResult {
  return {
    laborSubtotal: 900,
    materialsSubtotal: 100,
    commissionBase: 1000,
    commission: 100,
    professionalPayout: 900,
    platformGrossRevenue: 100,
    customerTotalPayable: 1000,
    jobId: "job-1",
    quoteId: "quote-1",
    professionalProfileId: "professional-1",
    companyProfileId: null,
    customerId: "customer-1",
    rates: { commissionRateBps: 1000 },
    ...overrides,
  };
}

export function makeTaxBreakdown(overrides: Partial<JobTaxBreakdownResult> = {}): JobTaxBreakdownResult {
  return {
    countryCode: "ES",
    labourBase: 900,
    professionalMaterialsBase: 100,
    customerMaterialsBase: 0,
    customerTaxableBase: 1000,
    customerVatRateBps: 2100,
    customerVatAmount: 210,
    customerGrossTotal: 1210,
    commissionBase: 1000,
    commissionRateBps: 1000,
    commissionAmount: 100,
    professionalNetBase: 900,
    professionalVatRateBps: 2100,
    professionalVatAmount: 189,
    professionalInvoiceGrossTotal: 1089,
    irpfWithholdingRateBps: 0,
    irpfWithholdingAmount: 0,
    professionalPayoutAmount: 1089,
    jobId: "job-1",
    quoteId: "quote-1",
    professionalProfileId: "professional-1",
    companyProfileId: null,
    customerId: "customer-1",
    ...overrides,
  };
}

export function makeInvoice(overrides: Partial<InvoiceRecord> = {}): InvoiceRecord {
  return {
    id: "invoice-1",
    invoiceNumber: "INV-2026-000001",
    type: "PROFESSIONAL_SELF_BILLED",
    status: "ISSUED",
    jobId: "job-1",
    quoteId: "quote-1",
    paymentId: "payment-1",
    professionalProfileId: "professional-1",
    companyProfileId: null,
    customerId: "customer-1",
    issuerLegalName: "MaestroYa S.L.",
    issuerTaxId: "B00000000",
    recipientLegalName: "Professional One",
    recipientTaxId: "12345678Z",
    selfBilled: true,
    selfBillingAuthorizationId: "authorization-1",
    issueDate: new Date("2026-01-02T00:00:00Z"),
    invoiceDate: new Date("2026-01-02T00:00:00Z"),
    acceptedAt: new Date("2026-01-01T12:00:00Z"),
    acceptedByUserId: "user-professional-1",
    acceptanceAgreementVersion: "v1",
    currency: "EUR",
    lineItems: [],
    taxableBase: 900,
    vatRateBps: 2100,
    vatAmount: 189,
    commissionBase: 1000,
    commissionRateBps: 1000,
    commissionAmount: 100,
    irpfWithholdingRateBps: 0,
    irpfWithholdingAmount: 0,
    totalAmount: 1089,
    documentHash: "hash123",
    version: 1,
    cancelledAt: null,
    cancelledByUserId: null,
    cancellationReason: null,
    createdAt: new Date("2026-01-01T00:00:00Z"),
    updatedAt: new Date("2026-01-02T00:00:00Z"),
    ...overrides,
  };
}

export function makePayout(overrides: Partial<PayoutRecord> = {}): PayoutRecord {
  return {
    id: "payout-1",
    jobId: "job-1",
    paymentId: "payment-1",
    professionalProfileId: "professional-1",
    companyProfileId: null,
    amount: 900,
    currency: "EUR",
    status: "PAID",
    stripeTransferId: "tr_test_1",
    idempotencyKey: "payout:job-1",
    failureReason: null,
    attemptCount: 1,
    lastAttemptedAt: new Date("2026-01-03T00:00:00Z"),
    processedAt: new Date("2026-01-03T00:00:00Z"),
    stripeReversalId: null,
    reversalIdempotencyKey: null,
    reversedAmount: null,
    reversalFailureReason: null,
    reversalAttemptCount: 0,
    reversedAt: null,
    createdAt: new Date("2026-01-03T00:00:00Z"),
    updatedAt: new Date("2026-01-03T00:00:00Z"),
    ...overrides,
  };
}

export function makeRefund(overrides: Partial<RefundRecord> = {}): RefundRecord {
  return {
    id: "refund-1",
    paymentId: "payment-1",
    requestedByUserId: "user-admin-1",
    amount: 200,
    status: "PROCESSED",
    stripeRefundId: "re_test_1",
    processedAt: new Date("2026-01-04T00:00:00Z"),
    notes: null,
    financialAdjustmentId: "adjustment-1",
    idempotencyKey: "refund:adjustment-1",
    failureReason: null,
    attemptCount: 1,
    createdAt: new Date("2026-01-04T00:00:00Z"),
    updatedAt: new Date("2026-01-04T00:00:00Z"),
    ...overrides,
  };
}

export function makeCreditNote(overrides: Partial<CreditNoteRecord> = {}): CreditNoteRecord {
  return {
    id: "credit-note-1",
    creditNoteNumber: "CN-2026-000001",
    status: "ISSUED",
    originalInvoiceId: "invoice-1",
    professionalProfileId: "professional-1",
    companyProfileId: null,
    reason: "Service not completed",
    idempotencyKey: "credit-note:invoice-1:1",
    issueDate: new Date("2026-01-05T00:00:00Z"),
    currency: "EUR",
    lineItems: [],
    reversedTaxableBase: 90,
    reversedVatRateBps: 2100,
    reversedVatAmount: 18.9,
    reversedCommissionAmount: 10,
    reversedIrpfWithholdingAmount: 0,
    totalAmount: 108.9,
    documentHash: "hashcn1",
    cancelledAt: null,
    cancelledByUserId: null,
    createdAt: new Date("2026-01-05T00:00:00Z"),
    updatedAt: new Date("2026-01-05T00:00:00Z"),
    ...overrides,
  };
}

export function makeContext(overrides: Partial<JobFinancialContext> = {}): JobFinancialContext {
  return {
    jobId: "job-1",
    jobStatus: "COMPLETED",
    quoteId: "quote-1",
    quoteCurrency: "EUR",
    quoteTotalAmount: 1000,
    professionalProfileId: "professional-1",
    companyProfileId: null,
    customerId: "customer-1",
    payments: [makePayment()],
    commission: makeCommission(),
    commissionBreakdown: makeCommissionBreakdown(),
    taxBreakdown: makeTaxBreakdown(),
    invoices: [makeInvoice()],
    payout: makePayout(),
    refunds: [],
    creditNotes: [],
    releaseApproved: true,
    ...overrides,
  };
}
