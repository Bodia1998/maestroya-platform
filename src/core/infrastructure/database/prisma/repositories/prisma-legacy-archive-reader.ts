import { Prisma, type PrismaClient } from "@prisma/client";

import { prisma } from "@/infrastructure/database/prisma/client";
import type { LegacyArchiveReader } from "@/domain/repositories/legacy-archive-reader";
import {
  LegacyArchiveScopeTooLargeError,
  NO_CURRENCY_ON_RECORD,
  archiveFieldNames,
  archiveRecordKey,
  type ArchiveControl,
  type ArchiveRawRow,
  type ArchiveTotal,
  type LegacyArchiveOptions,
  type LegacyArchiveSnapshot,
} from "@/domain/services/legacy-archive";
import { LEGACY_ARCHIVE_CATEGORIES, LEGACY_AUDIT_ENTITY_TYPES, LEGACY_COUNTER_SERIES, LEGACY_WEBHOOK_PROVIDER, type ArchiveCategorySpec } from "@/domain/services/legacy-archive-spec";

export const DEFAULT_ARCHIVE_PAGE_SIZE = 1_000;
export const DEFAULT_ARCHIVE_MAX_ROWS_PER_CATEGORY = 50_000;
export const DEFAULT_ARCHIVE_TRANSACTION_TIMEOUT_MS = 300_000;

export interface PrismaLegacyArchiveReaderOptions {
  pageSize?: number;
  /** Per-category ceiling. Exceeding it throws LegacyArchiveScopeTooLargeError — a subset is never exported as the whole. */
  maxRowsPerCategory?: number;
  transactionTimeoutMs?: number;
  /** Client whose `$transaction` is used; exists so a test can observe the real transaction. Production composition roots pass nothing. */
  client?: Pick<PrismaClient, "$transaction">;
}

const LEGACY = "LEGACY_QUOTE_PAYMENT" as const;
/** Relation filter: only records that belong to a LEGACY_QUOTE_PAYMENT service request. */
const legacyRequest = { flowVersion: LEGACY } as const;
const legacyJob = { serviceRequest: legacyRequest } as const;
const legacyInvoice = { job: legacyJob } as const;

/** The read methods the reader uses on a Prisma model delegate. Nothing else is reachable through this type. */
interface ReadDelegate {
  findMany(args: unknown): Promise<Record<string, unknown>[]>;
  count(args?: unknown): Promise<number>;
  aggregate(args: unknown): Promise<{ _sum: Record<string, unknown> }>;
  groupBy(args: unknown): Promise<Record<string, unknown>[]>;
}
const read = (delegate: unknown): ReadDelegate => delegate as ReadDelegate;

interface ScopeContext {
  /** Record keys already read, per category. */
  idsByCategory: ReadonlyMap<string, ReadonlySet<string>>;
  /** Union of every record key read so far. */
  allIds: ReadonlySet<string>;
}
interface Scope {
  delegate(tx: Prisma.TransactionClient): ReadDelegate;
  /** Database-side filter. Typed per model with `satisfies` so a wrong relation name fails the type check. */
  where: object;
  /** Extra in-memory filter (for scopes that depend on ids read earlier). When present there is no independent database control. */
  keep?(row: Record<string, unknown>, ctx: ScopeContext): boolean;
  /** Table without an `id` column: ordered by its natural key and read in one bounded query. */
  composite?: true;
}

/**
 * How each category is scoped to the legacy flow. Every table that has a service-request relation filters on
 * `flowVersion = LEGACY_QUOTE_PAYMENT`; tables without one are legacy-only by construction (M166 §5) or scoped by series / provider /
 * ids read earlier. The flow boundary is never reclassified.
 */
const SCOPES: Record<string, Scope> = {
  service_requests: { delegate: (tx) => read(tx.serviceRequest), where: { flowVersion: LEGACY } satisfies Prisma.ServiceRequestWhereInput },
  quotes: { delegate: (tx) => read(tx.quote), where: { serviceRequest: legacyRequest } satisfies Prisma.QuoteWhereInput },
  quote_items: { delegate: (tx) => read(tx.quoteItem), where: { quote: { serviceRequest: legacyRequest } } satisfies Prisma.QuoteItemWhereInput },
  jobs: { delegate: (tx) => read(tx.job), where: { serviceRequest: legacyRequest } satisfies Prisma.JobWhereInput },
  disputes: { delegate: (tx) => read(tx.dispute), where: { serviceRequest: legacyRequest } satisfies Prisma.DisputeWhereInput },
  job_completion_confirmations: { delegate: (tx) => read(tx.jobCompletionConfirmation), where: { job: legacyJob } satisfies Prisma.JobCompletionConfirmationWhereInput },
  appointments: { delegate: (tx) => read(tx.appointment), where: { serviceRequest: legacyRequest } satisfies Prisma.AppointmentWhereInput },
  payments: { delegate: (tx) => read(tx.payment), where: { serviceRequest: legacyRequest } satisfies Prisma.PaymentWhereInput },
  commissions: { delegate: (tx) => read(tx.commission), where: { payment: { serviceRequest: legacyRequest } } satisfies Prisma.CommissionWhereInput },
  payouts: { delegate: (tx) => read(tx.payout), where: {} satisfies Prisma.PayoutWhereInput },
  dispute_resolution_decisions: { delegate: (tx) => read(tx.disputeResolutionDecision), where: { job: legacyJob } satisfies Prisma.DisputeResolutionDecisionWhereInput },
  transactions: {
    delegate: (tx) => read(tx.transaction),
    where: {
      OR: [
        { payment: { serviceRequest: legacyRequest } },
        { refund: { payment: { serviceRequest: legacyRequest } } },
        { commission: { payment: { serviceRequest: legacyRequest } } },
        { financialAdjustment: { job: legacyJob } },
        { payoutId: { not: null } },
      ],
    } satisfies Prisma.TransactionWhereInput,
  },
  refunds: { delegate: (tx) => read(tx.refund), where: { payment: { serviceRequest: legacyRequest } } satisfies Prisma.RefundWhereInput },
  financial_adjustments: { delegate: (tx) => read(tx.financialAdjustment), where: { job: legacyJob } satisfies Prisma.FinancialAdjustmentWhereInput },
  stripe_disputes: { delegate: (tx) => read(tx.stripeDispute), where: {} satisfies Prisma.StripeDisputeWhereInput },
  dispute_evidence: { delegate: (tx) => read(tx.disputeEvidence), where: { dispute: { serviceRequest: legacyRequest } } satisfies Prisma.DisputeEvidenceWhereInput },
  self_billing_authorizations: { delegate: (tx) => read(tx.selfBillingAuthorization), where: {} satisfies Prisma.SelfBillingAuthorizationWhereInput },
  invoices: { delegate: (tx) => read(tx.invoice), where: { job: legacyJob } satisfies Prisma.InvoiceWhereInput },
  invoice_line_items: { delegate: (tx) => read(tx.invoiceLineItem), where: { invoice: legacyInvoice } satisfies Prisma.InvoiceLineItemWhereInput },
  credit_notes: { delegate: (tx) => read(tx.creditNote), where: { originalInvoice: legacyInvoice } satisfies Prisma.CreditNoteWhereInput },
  credit_note_line_items: { delegate: (tx) => read(tx.creditNoteLineItem), where: { creditNote: { originalInvoice: legacyInvoice } } satisfies Prisma.CreditNoteLineItemWhereInput },
  invoice_number_counters: { delegate: (tx) => read(tx.invoiceNumberCounter), where: { series: { in: [...LEGACY_COUNTER_SERIES] } } satisfies Prisma.InvoiceNumberCounterWhereInput, composite: true },
  reconciliation_runs: { delegate: (tx) => read(tx.reconciliationRun), where: {} satisfies Prisma.ReconciliationRunWhereInput },
  reconciliation_discrepancies: { delegate: (tx) => read(tx.reconciliationDiscrepancy), where: {} satisfies Prisma.ReconciliationDiscrepancyWhereInput },
  external_webhook_events: { delegate: (tx) => read(tx.externalWebhookEvent), where: { provider: LEGACY_WEBHOOK_PROVIDER } satisfies Prisma.ExternalWebhookEventWhereInput },
  affiliate_commissions: {
    delegate: (tx) => read(tx.affiliateCommission),
    where: {} satisfies Prisma.AffiliateCommissionWhereInput,
    keep: (row, ctx) => typeof row.platformCommissionRefId === "string" && (ctx.idsByCategory.get("commissions")?.has(row.platformCommissionRefId) ?? false),
  },
  affiliate_commission_reversals: {
    delegate: (tx) => read(tx.affiliateCommissionReversal),
    where: {} satisfies Prisma.AffiliateCommissionReversalWhereInput,
    keep: (row, ctx) => typeof row.affiliateCommissionId === "string" && (ctx.idsByCategory.get("affiliate_commissions")?.has(row.affiliateCommissionId) ?? false),
  },
  audit_logs: {
    delegate: (tx) => read(tx.auditLog),
    where: { entityType: { in: [...LEGACY_AUDIT_ENTITY_TYPES] }, entityId: { not: null } } satisfies Prisma.AuditLogWhereInput,
    keep: (row, ctx) => typeof row.entityId === "string" && ctx.allIds.has(row.entityId),
  },
};

type PageArgs = { take: number; orderBy: { id: "asc" }; cursor?: { id: string }; skip?: number };

const isDecimalLike = (v: unknown): v is { toFixed(digits: number): string } => typeof v === "object" && v !== null && typeof (v as { toFixed?: unknown }).toFixed === "function";
const money2 = (v: unknown): string => (typeof v === "string" ? v : isDecimalLike(v) ? v.toFixed(2) : String(v));

/**
 * Module 167 — Prisma implementation of the READ-ONLY legacy archive reader.
 *
 * Only reads are ever issued (`findMany`, `count`, `aggregate`, `groupBy` — pinned by a static test). Everything happens in ONE
 * interactive transaction that is READ ONLY and REPEATABLE READ, so every category is seen at a single point in time even while the
 * application keeps running (no payment read before a concurrent refund and the refund after). Each category is read with keyset
 * paging on its primary key, with an explicit `select` of exactly the fields the spec allows for the chosen options (never
 * `include`, never a whole row), bounded by a ceiling that fails closed instead of truncating. For every category scoped in the
 * database the reader also asks the database independently for the row count and exact money sums over the same filter; the
 * archive builder compares them with what was read.
 */
export class PrismaLegacyArchiveReader implements LegacyArchiveReader {
  private readonly pageSize: number;
  private readonly maxRows: number;
  private readonly timeoutMs: number;
  private readonly client: Pick<PrismaClient, "$transaction">;

  constructor(options: PrismaLegacyArchiveReaderOptions = {}) {
    this.client = options.client ?? prisma;
    this.pageSize = options.pageSize ?? DEFAULT_ARCHIVE_PAGE_SIZE;
    this.maxRows = options.maxRowsPerCategory ?? DEFAULT_ARCHIVE_MAX_ROWS_PER_CATEGORY;
    this.timeoutMs = options.transactionTimeoutMs ?? DEFAULT_ARCHIVE_TRANSACTION_TIMEOUT_MS;
    if (!Number.isInteger(this.pageSize) || this.pageSize < 1 || this.pageSize > 10_000) throw new RangeError("pageSize must be an integer in 1..10000");
    if (!Number.isInteger(this.maxRows) || this.maxRows < 1) throw new RangeError("maxRowsPerCategory must be a positive integer");
  }

  async readSnapshot(options: LegacyArchiveOptions): Promise<LegacyArchiveSnapshot> {
    return this.client.$transaction(
      async (tx) => {
        // Belt and braces: the database itself refuses any write in this transaction. Must precede the first query.
        await tx.$executeRawUnsafe("SET TRANSACTION READ ONLY");

        const categories: Record<string, { rows: ArchiveRawRow[]; tableTotal: number; control: ArchiveControl | null }> = {};
        const idsByCategory = new Map<string, Set<string>>();
        const allIds = new Set<string>();

        for (const spec of LEGACY_ARCHIVE_CATEGORIES) {
          const scope = SCOPES[spec.key];
          if (!scope) throw new Error(`No legacy scope is defined for archive category "${spec.key}"; refusing to export.`);
          const delegate = scope.delegate(tx);
          const select = Object.fromEntries(archiveFieldNames(spec, options).map((name) => [name, true]));

          const ctx: ScopeContext = { idsByCategory, allIds };
          // The in-memory legacy filter runs per page, BEFORE the ceiling is applied: shared tables (audit_logs, affiliate_*) also hold
          // rows of the live LEAD_V1 flow, and those must never count against the ceiling on what is archived.
          const keep = scope.keep ? (row: Record<string, unknown>) => scope.keep!(row, ctx) : undefined;
          const rows = scope.composite ? await this.readComposite(spec, delegate, scope.where, select) : await this.readPaged(spec.key, (page) => delegate.findMany({ where: scope.where, select, ...page }), keep);

          const tableTotal = await delegate.count({});
          const control = scope.keep ? null : await this.control(spec, delegate, scope.where);

          const keys = new Set<string>();
          for (const row of rows) keys.add(archiveRecordKey(spec, row));
          idsByCategory.set(spec.key, keys);
          for (const key of keys) allIds.add(key);
          categories[spec.key] = { rows, tableTotal, control };
        }
        return { categories };
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead, timeout: this.timeoutMs, maxWait: 10_000 },
    );
  }

  /**
   * Keyset paging on the primary key, bounded by the per-category ceiling. `keep` (in-memory scope) is applied to each page before
   * the ceiling is checked; the cursor and the end-of-data test always use the unfiltered page, so no row is skipped or repeated.
   */
  private async readPaged(table: string, fetch: (page: PageArgs) => Promise<Record<string, unknown>[]>, keep?: (row: Record<string, unknown>) => boolean): Promise<Record<string, unknown>[]> {
    const out: Record<string, unknown>[] = [];
    let cursor: string | undefined;
    for (;;) {
      const rows = await fetch({ take: this.pageSize, orderBy: { id: "asc" }, ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}) });
      if (rows.length === 0) break;
      for (const row of rows) if (!keep || keep(row)) out.push(row);
      if (out.length > this.maxRows) throw new LegacyArchiveScopeTooLargeError(table, this.maxRows);
      cursor = rows[rows.length - 1]?.id as string | undefined;
      if (rows.length < this.pageSize) break;
    }
    return out;
  }

  /** The only table without an `id` (composite primary key): small, so read in one query bounded by the ceiling. */
  private async readComposite(spec: ArchiveCategorySpec, delegate: ReadDelegate, where: object, select: Record<string, boolean>): Promise<Record<string, unknown>[]> {
    const rows = await delegate.findMany({ where, select, orderBy: [{ series: "asc" }, { year: "asc" }], take: this.maxRows + 1 });
    if (rows.length > this.maxRows) throw new LegacyArchiveScopeTooLargeError(spec.key, this.maxRows);
    return rows;
  }

  /** Independent database figures over the same filter: row count and exact sums (per currency where the row has one). */
  private async control(spec: ArchiveCategorySpec, delegate: ReadDelegate, where: object): Promise<ArchiveControl> {
    const count = await delegate.count({ where });
    const totals: ArchiveTotal[] = [];
    if (spec.totalFields.length > 0) {
      const _sum = Object.fromEntries(spec.totalFields.map((name) => [name, true]));
      if (spec.currencyField) {
        const groups = await delegate.groupBy({ by: [spec.currencyField], where, _sum });
        for (const group of groups) {
          const sums = (group._sum ?? {}) as Record<string, unknown>;
          for (const field of spec.totalFields) if (sums[field] !== null && sums[field] !== undefined) totals.push({ field, currency: String(group[spec.currencyField]), total: money2(sums[field]) });
        }
      } else {
        const aggregate = await delegate.aggregate({ where, _sum });
        for (const field of spec.totalFields) if (aggregate._sum[field] !== null && aggregate._sum[field] !== undefined) totals.push({ field, currency: NO_CURRENCY_ON_RECORD, total: money2(aggregate._sum[field]) });
      }
    }
    return { count, totals };
  }
}
