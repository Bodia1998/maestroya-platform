import { Prisma, type PrismaClient } from "@prisma/client";

import { prisma } from "@/infrastructure/database/prisma/client";
import type { LegacyWindDownReader } from "@/domain/repositories/legacy-wind-down-reader";
import {
  LEGACY_CAPTURED_PAYMENT_STATUSES,
  LEGACY_OPEN_ADJUSTMENT_STATUSES,
  LEGACY_OPEN_AFFILIATE_COMMISSION_STATUSES,
  LEGACY_OPEN_COMPLETION_STATUSES,
  LEGACY_OPEN_CREDIT_NOTE_STATUSES,
  LEGACY_OPEN_DECISION_STATUSES,
  LEGACY_OPEN_JOB_STATUSES,
  LEGACY_OPEN_PAYOUT_STATUSES,
  LEGACY_OPEN_QUOTE_STATUSES,
  LEGACY_OPEN_RECEIPT_INVOICE_STATUSES,
  LEGACY_OPEN_REFUND_STATUSES,
  LEGACY_OPEN_RELEASE_STATUSES,
  LEGACY_OPEN_REQUEST_STATUSES,
  LEGACY_OPEN_SELF_BILLED_INVOICE_STATUSES,
  LEGACY_OPEN_STRIPE_DISPUTE_STATUSES,
  LEGACY_PAYMENT_WEBHOOK_PROVIDER,
  LEGACY_UNCONFIRMED_PAYMENT_STATUSES,
  LEGACY_UNSETTLED_WEBHOOK_STATUSES,
  LegacyWindDownScopeTooLargeError,
  type LegacyWindDownSnapshot,
  type ObservedLegacyCapturedPayment,
  type ObservedLegacyReconciliationState,
} from "@/domain/services/legacy-wind-down";

export const DEFAULT_WIND_DOWN_PAGE_SIZE = 1_000;
export const DEFAULT_WIND_DOWN_MAX_ROWS_PER_KIND = 50_000;
export const DEFAULT_WIND_DOWN_TRANSACTION_TIMEOUT_MS = 120_000;

export interface PrismaLegacyWindDownReaderOptions {
  pageSize?: number;
  /** Per-kind ceiling. Exceeding it throws LegacyWindDownScopeTooLargeError — a subset is never reported as the whole inventory. */
  maxRowsPerKind?: number;
  transactionTimeoutMs?: number;
  /** Client whose `$transaction` is used; exists so a test can observe the real transaction. Production composition roots pass nothing. */
  client?: Pick<PrismaClient, "$transaction">;
}

const LEGACY = "LEGACY_QUOTE_PAYMENT" as const;
/** Relation filter: only records that belong to a LEGACY_QUOTE_PAYMENT service request. */
const legacyRequest = { flowVersion: LEGACY } as const;

const money = (value: Prisma.Decimal): string => value.toFixed(2);

type PageArgs = { take: number; orderBy: { id: "asc" }; cursor?: { id: string }; skip?: number };

/**
 * Module 166 — Prisma implementation of the READ-ONLY legacy wind-down reader.
 *
 * Only reads are ever issued (`findMany`, `findFirst`, `count`, `aggregate` — pinned by a static test). Everything happens in ONE
 * interactive transaction that is READ ONLY and REPEATABLE READ, so all kinds are seen at a single point in time even while the
 * application keeps running (no false "orphan" from reading a payment before and a payout after a concurrent write). Each kind is
 * read with keyset paging on the primary key, filtered in the database to the NON-FINAL statuses of the legacy flow and, where the
 * table has a relation to its service request, to `flowVersion = LEGACY_QUOTE_PAYMENT` (the flow boundary is never reclassified).
 * Tables without a service-request relation (payouts, stripe disputes, affiliate commissions, webhook events) are legacy-only by
 * construction: the M121/M131 guard keeps LEAD_V1 out of the legacy money paths, and the lead-fee flow has its own tables and
 * its own webhook provider key. Party data (names, tax ids, addresses, notes, free text) is never selected.
 */
export class PrismaLegacyWindDownReader implements LegacyWindDownReader {
  private readonly pageSize: number;
  private readonly maxRows: number;
  private readonly timeoutMs: number;
  private readonly client: Pick<PrismaClient, "$transaction">;

  constructor(options: PrismaLegacyWindDownReaderOptions = {}) {
    this.client = options.client ?? prisma;
    this.pageSize = options.pageSize ?? DEFAULT_WIND_DOWN_PAGE_SIZE;
    this.maxRows = options.maxRowsPerKind ?? DEFAULT_WIND_DOWN_MAX_ROWS_PER_KIND;
    this.timeoutMs = options.transactionTimeoutMs ?? DEFAULT_WIND_DOWN_TRANSACTION_TIMEOUT_MS;
    if (!Number.isInteger(this.pageSize) || this.pageSize < 1 || this.pageSize > 10_000) throw new RangeError("pageSize must be an integer in 1..10000");
    if (!Number.isInteger(this.maxRows) || this.maxRows < 1) throw new RangeError("maxRowsPerKind must be a positive integer");
  }

  async readSnapshot(): Promise<LegacyWindDownSnapshot> {
    return this.client.$transaction(
      async (tx) => {
        // Belt and braces: the database itself refuses any write in this transaction. Must precede the first query.
        await tx.$executeRawUnsafe("SET TRANSACTION READ ONLY");

        const serviceRequests = (
          await this.all("service_requests", (a) =>
            tx.serviceRequest.findMany({ where: { flowVersion: LEGACY, status: { in: [...LEGACY_OPEN_REQUEST_STATUSES] } }, select: { id: true, status: true, createdAt: true }, ...a }),
          )
        ).map((r) => ({ id: r.id, status: r.status as string, createdAt: r.createdAt }));

        const quotes = (
          await this.all("quotes", (a) =>
            tx.quote.findMany({ where: { status: { in: [...LEGACY_OPEN_QUOTE_STATUSES] }, serviceRequest: legacyRequest }, select: { id: true, status: true, validUntil: true }, ...a }),
          )
        ).map((r) => ({ id: r.id, status: r.status as string, validUntil: r.validUntil }));

        const jobs = (
          await this.all("jobs", (a) =>
            tx.job.findMany({ where: { status: { in: [...LEGACY_OPEN_JOB_STATUSES] }, serviceRequest: legacyRequest }, select: { id: true, status: true }, ...a }),
          )
        ).map((r) => ({ id: r.id, status: r.status as string }));

        const completionConfirmations = (
          await this.all("job_completion_confirmations", (a) =>
            tx.jobCompletionConfirmation.findMany({
              where: {
                job: { serviceRequest: legacyRequest },
                OR: [{ status: { in: [...LEGACY_OPEN_COMPLETION_STATUSES] } }, { releaseStatus: { in: [...LEGACY_OPEN_RELEASE_STATUSES] } }],
              },
              select: { id: true, jobId: true, status: true, releaseStatus: true },
              ...a,
            }),
          )
        ).map((r) => ({ id: r.id, jobId: r.jobId, status: r.status as string, releaseStatus: r.releaseStatus as string }));

        const unconfirmedPayments = (
          await this.all("payments(unconfirmed)", (a) =>
            tx.payment.findMany({
              where: { status: { in: [...LEGACY_UNCONFIRMED_PAYMENT_STATUSES] }, serviceRequest: legacyRequest },
              select: { id: true, status: true, amount: true, currency: true },
              ...a,
            }),
          )
        ).map((r) => ({ id: r.id, status: r.status as string, amount: money(r.amount), currency: r.currency }));

        const capturedPayments = await this.readCapturedPayments(tx);

        const payouts = (
          await this.all("payouts", (a) =>
            tx.payout.findMany({
              where: { OR: [{ status: { in: [...LEGACY_OPEN_PAYOUT_STATUSES] } }, { AND: [{ reversalFailureReason: { not: null } }, { status: { not: "REVERSED" } }] }] },
              select: { id: true, status: true, amount: true, currency: true, jobId: true, reversalFailureReason: true },
              ...a,
            }),
          )
        ).map((r) => ({ id: r.id, status: r.status as string, amount: money(r.amount), currency: r.currency, jobId: r.jobId, reversalIncomplete: r.reversalFailureReason !== null }));

        const refunds = (
          await this.all("refunds", (a) =>
            tx.refund.findMany({
              where: { status: { in: [...LEGACY_OPEN_REFUND_STATUSES] }, payment: { serviceRequest: legacyRequest } },
              select: { id: true, status: true, amount: true, paymentId: true, payment: { select: { currency: true } } },
              ...a,
            }),
          )
        ).map((r) => ({ id: r.id, status: r.status as string, amount: money(r.amount), currency: r.payment.currency, paymentId: r.paymentId }));

        const financialAdjustments = (
          await this.all("financial_adjustments", (a) =>
            tx.financialAdjustment.findMany({
              where: { status: { in: [...LEGACY_OPEN_ADJUSTMENT_STATUSES] }, job: { serviceRequest: legacyRequest } },
              select: { id: true, status: true, amount: true, currency: true, jobId: true },
              ...a,
            }),
          )
        ).map((r) => ({ id: r.id, status: r.status as string, amount: money(r.amount), currency: r.currency, jobId: r.jobId }));

        const disputeResolutionDecisions = (
          await this.all("dispute_resolution_decisions", (a) =>
            tx.disputeResolutionDecision.findMany({
              where: { status: { in: [...LEGACY_OPEN_DECISION_STATUSES] }, job: { serviceRequest: legacyRequest } },
              select: { id: true, status: true, disputeId: true },
              ...a,
            }),
          )
        ).map((r) => ({ id: r.id, status: r.status as string, disputeId: r.disputeId }));

        const disputes = (
          await this.all("disputes", (a) =>
            tx.dispute.findMany({ where: { status: { not: "CLOSED" }, serviceRequest: legacyRequest }, select: { id: true, status: true }, ...a }),
          )
        ).map((r) => ({ id: r.id, status: r.status as string }));

        const stripeDisputes = (
          await this.all("stripe_disputes", (a) =>
            tx.stripeDispute.findMany({
              where: { OR: [{ status: { in: [...LEGACY_OPEN_STRIPE_DISPUTE_STATUSES] } }, { status: "LOST", financialAdjustmentId: null }] },
              select: { id: true, status: true, amount: true, currency: true, financialAdjustmentId: true },
              ...a,
            }),
          )
        ).map((r) => ({ id: r.id, status: r.status as string, amount: money(r.amount), currency: r.currency, financialAdjustmentId: r.financialAdjustmentId }));

        const invoices = (
          await this.all("invoices", (a) =>
            tx.invoice.findMany({
              where: {
                job: { serviceRequest: legacyRequest },
                OR: [
                  { type: "PROFESSIONAL_SELF_BILLED", status: { in: [...LEGACY_OPEN_SELF_BILLED_INVOICE_STATUSES] } },
                  { type: "CUSTOMER_RECEIPT", status: { in: [...LEGACY_OPEN_RECEIPT_INVOICE_STATUSES] } },
                ],
              },
              select: { id: true, type: true, status: true, totalAmount: true, currency: true },
              ...a,
            }),
          )
        ).map((r) => ({ id: r.id, type: r.type as string, status: r.status as string, totalAmount: money(r.totalAmount), currency: r.currency }));

        const creditNotes = (
          await this.all("credit_notes", (a) =>
            tx.creditNote.findMany({
              where: { status: { in: [...LEGACY_OPEN_CREDIT_NOTE_STATUSES] }, originalInvoice: { job: { serviceRequest: legacyRequest } } },
              select: { id: true, status: true, totalAmount: true, currency: true },
              ...a,
            }),
          )
        ).map((r) => ({ id: r.id, status: r.status as string, totalAmount: money(r.totalAmount), currency: r.currency }));

        const affiliateCommissions = (
          await this.all("affiliate_commissions", (a) =>
            tx.affiliateCommission.findMany({ where: { status: { in: [...LEGACY_OPEN_AFFILIATE_COMMISSION_STATUSES] } }, select: { id: true, status: true, affiliateAmount: true }, ...a }),
          )
        ).map((r) => ({ id: r.id, status: r.status as string, affiliateAmount: money(r.affiliateAmount) }));

        const webhookEvents = (
          await this.all("external_webhook_events", (a) =>
            tx.externalWebhookEvent.findMany({
              where: { provider: LEGACY_PAYMENT_WEBHOOK_PROVIDER, status: { in: [...LEGACY_UNSETTLED_WEBHOOK_STATUSES] } },
              select: { id: true, status: true },
              ...a,
            }),
          )
        ).map((r) => ({ id: r.id, status: r.status as string }));

        const reconciliation = await this.readReconciliation(tx);

        const [pay, pout, ref, adj, inv, cn, sd, drd, com] = await Promise.all([
          tx.payment.aggregate({ _max: { updatedAt: true }, where: { serviceRequest: legacyRequest } }),
          tx.payout.aggregate({ _max: { updatedAt: true } }),
          tx.refund.aggregate({ _max: { updatedAt: true }, where: { payment: { serviceRequest: legacyRequest } } }),
          tx.financialAdjustment.aggregate({ _max: { updatedAt: true }, where: { job: { serviceRequest: legacyRequest } } }),
          tx.invoice.aggregate({ _max: { updatedAt: true }, where: { job: { serviceRequest: legacyRequest } } }),
          tx.creditNote.aggregate({ _max: { updatedAt: true }, where: { originalInvoice: { job: { serviceRequest: legacyRequest } } } }),
          tx.stripeDispute.aggregate({ _max: { updatedAt: true } }),
          tx.disputeResolutionDecision.aggregate({ _max: { updatedAt: true }, where: { job: { serviceRequest: legacyRequest } } }),
          tx.commission.aggregate({ _max: { updatedAt: true }, where: { payment: { serviceRequest: legacyRequest } } }),
        ]);
        const changes = [pay, pout, ref, adj, inv, cn, sd, drd, com].map((a) => a._max.updatedAt).filter((d): d is Date => d !== null);
        const latestLegacyFinancialChangeAt = changes.length === 0 ? null : new Date(Math.max(...changes.map((d) => d.getTime())));

        const [legacyRequestTotal, newest] = await Promise.all([
          tx.serviceRequest.count({ where: { flowVersion: LEGACY } }),
          tx.serviceRequest.aggregate({ _max: { createdAt: true }, where: { flowVersion: LEGACY } }),
        ]);

        return {
          serviceRequests,
          quotes,
          jobs,
          completionConfirmations,
          unconfirmedPayments,
          capturedPayments,
          payouts,
          refunds,
          financialAdjustments,
          disputeResolutionDecisions,
          disputes,
          stripeDisputes,
          invoices,
          creditNotes,
          affiliateCommissions,
          webhookEvents,
          reconciliation,
          latestLegacyFinancialChangeAt,
          legacyRequestTotal,
          newestLegacyRequestCreatedAt: newest._max.createdAt,
        } satisfies LegacyWindDownSnapshot;
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead, timeout: this.timeoutMs, maxWait: 10_000 },
    );
  }

  /** Keyset paging on the primary key, bounded by the per-kind ceiling. */
  private async all<R extends { id: string }>(table: string, fetch: (args: PageArgs) => Promise<R[]>): Promise<R[]> {
    const out: R[] = [];
    let cursor: string | undefined;
    for (;;) {
      const rows = await fetch({ take: this.pageSize, orderBy: { id: "asc" }, ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}) });
      if (rows.length === 0) break;
      out.push(...rows);
      if (out.length > this.maxRows) throw new LegacyWindDownScopeTooLargeError(table, this.maxRows);
      cursor = rows[rows.length - 1]?.id;
      if (rows.length < this.pageSize) break;
    }
    return out;
  }

  /** Captured / partially-refunded payments, with the job, release and payout facts needed to classify their disposition. */
  private async readCapturedPayments(tx: Prisma.TransactionClient): Promise<ObservedLegacyCapturedPayment[]> {
    const payments = await this.all("payments(captured)", (a) =>
      tx.payment.findMany({
        where: { status: { in: [...LEGACY_CAPTURED_PAYMENT_STATUSES] }, serviceRequest: legacyRequest },
        select: {
          id: true,
          status: true,
          amount: true,
          currency: true,
          quote: { select: { job: { select: { id: true, status: true, completionConfirmation: { select: { releaseStatus: true } } } } } },
        },
        ...a,
      }),
    );

    const payoutStatusesByPayment = new Map<string, string[]>();
    const payoutStatusesByJob = new Map<string, string[]>();
    for (let i = 0; i < payments.length; i += this.pageSize) {
      const chunk = payments.slice(i, i + this.pageSize);
      const paymentIds = chunk.map((p) => p.id);
      const jobIds = chunk.map((p) => p.quote?.job?.id).filter((id): id is string => typeof id === "string");
      const rows = await tx.payout.findMany({
        where: { OR: [{ paymentId: { in: paymentIds } }, ...(jobIds.length > 0 ? [{ jobId: { in: jobIds } }] : [])] },
        select: { paymentId: true, jobId: true, status: true },
        orderBy: { id: "asc" },
      });
      for (const r of rows) {
        if (r.paymentId) payoutStatusesByPayment.set(r.paymentId, [...(payoutStatusesByPayment.get(r.paymentId) ?? []), r.status]);
        if (r.jobId) payoutStatusesByJob.set(r.jobId, [...(payoutStatusesByJob.get(r.jobId) ?? []), r.status]);
      }
    }

    return payments.map((p) => {
      const job = p.quote?.job ?? null;
      const statuses = new Set<string>([...(payoutStatusesByPayment.get(p.id) ?? []), ...(job ? (payoutStatusesByJob.get(job.id) ?? []) : [])]);
      return {
        id: p.id,
        status: p.status as string,
        amount: money(p.amount),
        currency: p.currency,
        jobStatus: job ? (job.status as string) : null,
        releaseStatus: job?.completionConfirmation ? (job.completionConfirmation.releaseStatus as string) : null,
        payoutStatuses: [...statuses].sort(),
      };
    });
  }

  private async readReconciliation(tx: Prisma.TransactionClient): Promise<ObservedLegacyReconciliationState> {
    const [info, warning, error, critical, run, running] = await Promise.all([
      tx.reconciliationDiscrepancy.count({ where: { resolutionStatus: "OPEN", severity: "INFO" } }),
      tx.reconciliationDiscrepancy.count({ where: { resolutionStatus: "OPEN", severity: "WARNING" } }),
      tx.reconciliationDiscrepancy.count({ where: { resolutionStatus: "OPEN", severity: "ERROR" } }),
      tx.reconciliationDiscrepancy.count({ where: { resolutionStatus: "OPEN", severity: "CRITICAL" } }),
      tx.reconciliationRun.findFirst({
        where: { scope: "FULL", status: "COMPLETED" },
        orderBy: [{ startedAt: "desc" }, { id: "desc" }],
        select: { id: true, startedAt: true, completedAt: true, discrepancyCount: true, recordsInspected: true },
      }),
      tx.reconciliationRun.count({ where: { status: "RUNNING" } }),
    ]);
    return {
      openDiscrepancies: { INFO: info, WARNING: warning, ERROR: error, CRITICAL: critical },
      latestCompletedFullRun: run ? { id: run.id, startedAt: run.startedAt, completedAt: run.completedAt, discrepancyCount: run.discrepancyCount, recordsInspected: run.recordsInspected } : null,
      runningRunCount: running,
    };
  }
}
