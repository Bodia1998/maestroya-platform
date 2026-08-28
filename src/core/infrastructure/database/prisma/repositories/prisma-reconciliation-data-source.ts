import "server-only";

import { prisma } from "@/infrastructure/database/prisma/client";
import { PrismaJobCompletionConfirmationRepository } from "@/infrastructure/database/prisma/repositories/prisma-job-completion-confirmation-repository";
import { PrismaCommissionRepository } from "@/infrastructure/database/prisma/repositories/prisma-commission-repository";
import { PrismaPaymentRepository } from "@/infrastructure/database/prisma/repositories/prisma-payment-repository";
import {
  makeCalculateJobCommissionBreakdownUseCase,
  makeCalculateJobTaxBreakdownUseCase,
} from "@/application/use-cases/financial/compose";
import type {
  ListJobsForReconciliationOptions,
  ReconciliationDataSource,
} from "@/application/ports/reconciliation-data-source";
import type { JobFinancialContext } from "@/domain/services/reconciliation/context";
import type { CreditNoteRecord } from "@/domain/repositories/credit-note-repository";
import type { InvoiceRecord } from "@/domain/repositories/invoice-repository";
import type { PayoutRecord } from "@/domain/repositories/payout-repository";
import type { RefundRecord } from "@/domain/repositories/refund-repository";

const payments = new PrismaPaymentRepository();
const commissions = new PrismaCommissionRepository();
const completionConfirmations = new PrismaJobCompletionConfirmationRepository();
const commissionBreakdowns = makeCalculateJobCommissionBreakdownUseCase();
const taxBreakdowns = makeCalculateJobTaxBreakdownUseCase();

function toInvoiceRecord(row: {
  id: string;
  invoiceNumber: string | null;
  type: string;
  status: string;
  jobId: string;
  quoteId: string;
  paymentId: string | null;
  professionalProfileId: string | null;
  companyProfileId: string | null;
  customerId: string;
  issuerLegalName: string;
  issuerTaxId: string;
  recipientLegalName: string;
  recipientTaxId: string | null;
  selfBillingAuthorizationId: string;
  issueDate: Date | null;
  invoiceDate: Date;
  acceptedAt: Date | null;
  acceptedByUserId: string | null;
  acceptanceAgreementVersion: string | null;
  currency: string;
  taxableBase: unknown;
  vatRateBps: number;
  vatAmount: unknown;
  commissionBase: unknown;
  commissionRateBps: number;
  commissionAmount: unknown;
  irpfWithholdingRateBps: number;
  irpfWithholdingAmount: unknown;
  totalAmount: unknown;
  documentHash: string | null;
  version: number;
  cancelledAt: Date | null;
  cancelledByUserId: string | null;
  cancellationReason: string | null;
  lineItems: { id: string; description: string; quantity: unknown; unitPrice: unknown; amount: unknown; sortOrder: number; category: string }[];
  createdAt: Date;
  updatedAt: Date;
}): InvoiceRecord {
  return {
    id: row.id,
    invoiceNumber: row.invoiceNumber,
    type: row.type as InvoiceRecord["type"],
    status: row.status as InvoiceRecord["status"],
    jobId: row.jobId,
    quoteId: row.quoteId,
    paymentId: row.paymentId,
    professionalProfileId: row.professionalProfileId,
    companyProfileId: row.companyProfileId,
    customerId: row.customerId,
    issuerLegalName: row.issuerLegalName,
    issuerTaxId: row.issuerTaxId,
    recipientLegalName: row.recipientLegalName,
    recipientTaxId: row.recipientTaxId,
    selfBilled: true,
    selfBillingAuthorizationId: row.selfBillingAuthorizationId,
    issueDate: row.issueDate,
    invoiceDate: row.invoiceDate,
    acceptedAt: row.acceptedAt,
    acceptedByUserId: row.acceptedByUserId,
    acceptanceAgreementVersion: row.acceptanceAgreementVersion,
    currency: row.currency,
    lineItems: row.lineItems.map((li) => ({
      id: li.id,
      description: li.description,
      quantity: Number(li.quantity),
      unitPrice: Number(li.unitPrice),
      amount: Number(li.amount),
      sortOrder: li.sortOrder,
      category: li.category as "LABOR" | "MATERIALS",
    })),
    taxableBase: Number(row.taxableBase),
    vatRateBps: row.vatRateBps,
    vatAmount: Number(row.vatAmount),
    commissionBase: Number(row.commissionBase),
    commissionRateBps: row.commissionRateBps,
    commissionAmount: Number(row.commissionAmount),
    irpfWithholdingRateBps: row.irpfWithholdingRateBps,
    irpfWithholdingAmount: Number(row.irpfWithholdingAmount),
    totalAmount: Number(row.totalAmount),
    documentHash: row.documentHash,
    version: row.version,
    cancelledAt: row.cancelledAt,
    cancelledByUserId: row.cancelledByUserId,
    cancellationReason: row.cancellationReason,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

function toPayoutRecord(row: {
  id: string;
  jobId: string | null;
  paymentId: string | null;
  professionalProfileId: string | null;
  companyProfileId: string | null;
  amount: unknown;
  currency: string;
  status: string;
  stripeTransferId: string | null;
  idempotencyKey: string | null;
  failureReason: string | null;
  attemptCount: number;
  lastAttemptedAt: Date | null;
  processedAt: Date | null;
  stripeReversalId: string | null;
  reversalIdempotencyKey: string | null;
  reversedAmount: unknown;
  reversalFailureReason: string | null;
  reversalAttemptCount: number;
  reversedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}): PayoutRecord {
  return {
    id: row.id,
    jobId: row.jobId,
    paymentId: row.paymentId,
    professionalProfileId: row.professionalProfileId,
    companyProfileId: row.companyProfileId,
    amount: Number(row.amount),
    currency: row.currency,
    status: row.status as PayoutRecord["status"],
    stripeTransferId: row.stripeTransferId,
    idempotencyKey: row.idempotencyKey,
    failureReason: row.failureReason,
    attemptCount: row.attemptCount,
    lastAttemptedAt: row.lastAttemptedAt,
    processedAt: row.processedAt,
    stripeReversalId: row.stripeReversalId,
    reversalIdempotencyKey: row.reversalIdempotencyKey,
    reversedAmount: row.reversedAmount === null ? null : Number(row.reversedAmount),
    reversalFailureReason: row.reversalFailureReason,
    reversalAttemptCount: row.reversalAttemptCount,
    reversedAt: row.reversedAt,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

function toRefundRecord(row: {
  id: string;
  paymentId: string;
  requestedByUserId: string;
  amount: unknown;
  status: string;
  stripeRefundId: string | null;
  processedAt: Date | null;
  notes: string | null;
  financialAdjustmentId: string | null;
  idempotencyKey: string | null;
  failureReason: string | null;
  attemptCount: number;
  createdAt: Date;
  updatedAt: Date;
}): RefundRecord {
  return {
    id: row.id,
    paymentId: row.paymentId,
    requestedByUserId: row.requestedByUserId,
    amount: Number(row.amount),
    status: row.status as RefundRecord["status"],
    stripeRefundId: row.stripeRefundId,
    processedAt: row.processedAt,
    notes: row.notes,
    financialAdjustmentId: row.financialAdjustmentId,
    idempotencyKey: row.idempotencyKey,
    failureReason: row.failureReason,
    attemptCount: row.attemptCount,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

function toCreditNoteRecord(row: {
  id: string;
  creditNoteNumber: string | null;
  status: string;
  originalInvoiceId: string;
  professionalProfileId: string | null;
  companyProfileId: string | null;
  reason: string;
  idempotencyKey: string;
  issueDate: Date | null;
  currency: string;
  reversedTaxableBase: unknown;
  reversedVatRateBps: number;
  reversedVatAmount: unknown;
  reversedCommissionAmount: unknown;
  reversedIrpfWithholdingAmount: unknown;
  totalAmount: unknown;
  documentHash: string | null;
  cancelledAt: Date | null;
  cancelledByUserId: string | null;
  lineItems: { id: string; description: string; amount: unknown }[];
  createdAt: Date;
  updatedAt: Date;
}): CreditNoteRecord {
  return {
    id: row.id,
    creditNoteNumber: row.creditNoteNumber,
    status: row.status as CreditNoteRecord["status"],
    originalInvoiceId: row.originalInvoiceId,
    professionalProfileId: row.professionalProfileId,
    companyProfileId: row.companyProfileId,
    reason: row.reason,
    idempotencyKey: row.idempotencyKey,
    issueDate: row.issueDate,
    currency: row.currency,
    lineItems: row.lineItems.map((li) => ({ id: li.id, description: li.description, amount: Number(li.amount) })),
    reversedTaxableBase: Number(row.reversedTaxableBase),
    reversedVatRateBps: row.reversedVatRateBps,
    reversedVatAmount: Number(row.reversedVatAmount),
    reversedCommissionAmount: Number(row.reversedCommissionAmount),
    reversedIrpfWithholdingAmount: Number(row.reversedIrpfWithholdingAmount),
    totalAmount: Number(row.totalAmount),
    documentHash: row.documentHash,
    cancelledAt: row.cancelledAt,
    cancelledByUserId: row.cancelledByUserId,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

/**
 * Module 80 — Financial Reconciliation & Observability.
 *
 * Prisma implementation of `ReconciliationDataSource`. Every method here
 * is read-only — no `create`/`update`/`delete` is ever called against
 * `payments`/`invoices`/`payouts`/`refunds`/`credit_notes`/`commissions`
 * or any other Module 22/64/73-79 table.
 *
 * `commissionBreakdowns`/`taxBreakdowns` reuse the exact same composed
 * `CalculateJobCommissionBreakdownUseCase`/`CalculateJobTaxBreakdownUseCase`
 * instances Modules 22/78 themselves use (imported from
 * `application/use-cases/financial/compose.ts`) — this file never
 * constructs a second instance or re-implements their query logic.
 *
 * ## Why a bounded scan, not an unbounded full-history sweep
 * A single reconciliation run inspects at most `limit` Jobs (default 500
 * — see `startReconciliationRunSchema`), most-recently-active first. This
 * is a deliberate scoping decision, not an oversight: MaestroYa's
 * financial history only grows, and an unbounded scan would make a single
 * run's cost unpredictable and its `durationMs` meaningless for
 * operational alerting. A daily/hourly scheduled run (Module 80's
 * scheduling itself is an operational decision left to the platform's
 * existing job/cron infrastructure, not implemented by this class) can
 * cover the full ledger over time by moving its own `since` window
 * forward; a full backfill is a matter of running with a wide `since` and
 * a high `limit` (or several runs in sequence) — see
 * MODULE_80_IMPLEMENTATION_REPORT.md, "Remaining risks," for this
 * documented as an operational (not implemented-here) concern.
 */
export class PrismaReconciliationDataSource implements ReconciliationDataSource {
  async listJobIdsToInspect(options: ListJobsForReconciliationOptions): Promise<string[]> {
    const rows = await prisma.job.findMany({
      where: {
        quote: { payments: { some: {} } },
        ...(options.since ? { updatedAt: { gte: options.since } } : {}),
      },
      select: { id: true },
      orderBy: { updatedAt: "desc" },
      take: options.limit,
    });
    return rows.map((r) => r.id);
  }

  async getJobFinancialContext(jobId: string): Promise<JobFinancialContext | null> {
    const job = await prisma.job.findUnique({
      where: { id: jobId },
      select: {
        id: true,
        status: true,
        quoteId: true,
        customerId: true,
        professionalProfileId: true,
        companyProfileId: true,
        quote: { select: { totalAmount: true, currency: true } },
      },
    });
    if (!job || !job.quote) return null;

    const [paymentRecords, invoiceRows, payoutRow, completionConfirmation] = await Promise.all([
      payments.findByJobId(jobId),
      prisma.invoice.findMany({
        where: { jobId },
        include: { lineItems: { orderBy: { sortOrder: "asc" } } },
        orderBy: { createdAt: "asc" },
      }),
      prisma.payout.findUnique({ where: { jobId } }),
      completionConfirmations.findByJobId(jobId),
    ]);

    // Commission is 1:1 with a Payment, not with a Job directly — find it
    // via whichever payment on this job (if any) has one. Reuses the
    // already-fetched paymentRecords rather than re-querying.
    let commission = null;
    for (const p of paymentRecords) {
      const c = await commissions.findByPaymentId(p.id);
      if (c) {
        commission = c;
        break;
      }
    }

    const invoices = invoiceRows.map(toInvoiceRecord);
    const invoiceIds = invoices.map((inv) => inv.id);

    const [refundRows, creditNoteRows] = await Promise.all([
      paymentRecords.length > 0
        ? prisma.refund.findMany({ where: { paymentId: { in: paymentRecords.map((p) => p.id) } } })
        : Promise.resolve([]),
      invoiceIds.length > 0
        ? prisma.creditNote.findMany({ where: { originalInvoiceId: { in: invoiceIds } }, include: { lineItems: true } })
        : Promise.resolve([]),
    ]);

    let commissionBreakdown = null;
    let taxBreakdown = null;
    try {
      commissionBreakdown = await commissionBreakdowns.execute(jobId);
    } catch {
      commissionBreakdown = null;
    }
    try {
      taxBreakdown = await taxBreakdowns.execute(jobId);
    } catch {
      taxBreakdown = null;
    }

    return {
      jobId: job.id,
      jobStatus: job.status,
      quoteId: job.quoteId,
      quoteCurrency: job.quote.currency,
      quoteTotalAmount: Number(job.quote.totalAmount),
      professionalProfileId: job.professionalProfileId,
      companyProfileId: job.companyProfileId,
      customerId: job.customerId,
      payments: paymentRecords,
      commission,
      commissionBreakdown,
      taxBreakdown,
      invoices,
      payout: payoutRow ? toPayoutRecord(payoutRow) : null,
      refunds: refundRows.map(toRefundRecord),
      creditNotes: creditNoteRows.map(toCreditNoteRecord),
      releaseApproved: completionConfirmation?.releaseStatus === "RELEASE_APPROVED",
    };
  }
}
