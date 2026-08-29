/**
 * Module 80 — Financial Reconciliation & Observability.
 *
 * Repository ports for the two new persisted aggregates this module
 * introduces: `ReconciliationRun` (one row per execution of the
 * reconciliation engine) and `ReconciliationDiscrepancy` (one row per
 * detected inconsistency, preserved forever — see this file's own doc
 * comments below on why history is never deleted).
 *
 * This module is read-only with respect to every Module 73-79 financial
 * record it inspects (Payment, Commission, Invoice, Payout, Refund,
 * CreditNote, Transaction, FinancialAdjustment). Nothing in this
 * repository — or anywhere else in Module 80 — ever writes to those
 * tables. The only tables this module writes to are the two declared
 * here.
 */

export type ReconciliationRunStatusValue = "RUNNING" | "COMPLETED" | "FAILED";

export type ReconciliationScopeValue =
  | "FULL"
  | "PAYMENT"
  | "COMMISSION"
  | "TAX"
  | "INVOICE"
  | "PAYOUT"
  | "REFUND"
  | "CREDIT_NOTE"
  | "PROVIDER";

export type DiscrepancyEntityTypeValue =
  | "PAYMENT"
  | "COMMISSION"
  | "TAX_BREAKDOWN"
  | "INVOICE"
  | "PAYOUT"
  | "REFUND"
  | "CREDIT_NOTE"
  | "PROVIDER_EVENT";

export type DiscrepancyCategoryValue =
  | "PAYMENT_MISSING_JOB_OR_QUOTE"
  | "PAYMENT_AMOUNT_MISMATCH"
  | "PAYMENT_SUCCESSFUL_WITHOUT_RELATIONSHIP"
  | "DUPLICATE_PAYMENT"
  | "PAYMENT_CURRENCY_MISMATCH"
  | "COMMISSION_RATE_MISMATCH"
  | "COMMISSION_AMOUNT_MISMATCH"
  | "COMMISSION_PROFESSIONAL_NET_MISMATCH"
  | "COMMISSION_ALLOCATION_MISMATCH"
  | "COMMISSION_LEDGER_INCONSISTENT"
  | "TAX_TAXABLE_BASE_MISMATCH"
  | "TAX_RATE_MISMATCH"
  | "TAX_AMOUNT_MISMATCH"
  | "TAX_PROFESSIONAL_SIDE_MISMATCH"
  | "TAX_CUSTOMER_SIDE_MISMATCH"
  | "TAX_IRPF_MISMATCH"
  | "TAX_INVOICE_TOTAL_MISMATCH"
  | "INVOICE_INVALID_JOB_REFERENCE"
  | "INVOICE_WRONG_PARTY"
  | "INVOICE_AMOUNT_INCONSISTENT_WITH_TAX_BREAKDOWN"
  | "INVOICE_TAX_AMOUNT_INCONSISTENT"
  | "INVOICE_COMMISSION_AMOUNT_INCONSISTENT"
  | "INVOICE_ISSUED_WITHOUT_PREREQUISITES"
  | "INVOICE_PAID_WITHOUT_PAYOUT"
  | "DUPLICATE_ACTIVE_INVOICE"
  | "INVOICE_NUMBERING_ANOMALY"
  | "INVOICE_MISSING_IMMUTABLE_METADATA"
  | "INVOICE_CREDIT_NOTE_INCONSISTENT"
  | "PAYOUT_MISSING_ELIGIBLE_RELATIONSHIP"
  | "PAYOUT_AMOUNT_MISMATCH"
  | "PAYOUT_EXCEEDS_PAYABLE_AMOUNT"
  | "PAYOUT_MISSING_REQUIRED_INVOICE_STATE"
  | "DUPLICATE_PAYOUT"
  | "PAYOUT_CURRENCY_MISMATCH"
  | "PAYOUT_PROVIDER_REFERENCE_MISMATCH"
  | "REFUND_EXCEEDS_REFUNDABLE_AMOUNT"
  | "DUPLICATE_REFUND"
  | "REFUND_AMOUNT_OR_CURRENCY_MISMATCH"
  | "REFUND_MISSING_PAYMENT_RELATIONSHIP"
  | "REFUND_STATE_INCONSISTENT_WITH_PAYMENT"
  | "REFUND_CREDIT_NOTE_INCONSISTENT"
  | "CREDIT_NOTE_INVALID_INVOICE_REFERENCE"
  | "CREDIT_NOTE_WRONG_PARTY"
  | "CREDIT_NOTE_EXCEEDS_REMAINING_CREDITABLE_AMOUNT"
  | "CREDIT_NOTE_TAX_REVERSAL_MISMATCH"
  | "CREDIT_NOTE_ISSUED_WITHOUT_REQUIRED_STATE"
  | "DUPLICATE_CREDIT_NOTE"
  | "CREDIT_NOTE_NUMBERING_ANOMALY"
  | "CREDIT_NOTE_AMOUNT_OR_CURRENCY_MISMATCH"
  | "PROVIDER_STATE_UNKNOWN"
  | "PROVIDER_LOCAL_STATE_MISMATCH"
  | "PROVIDER_AMOUNT_MISMATCH";

export type DiscrepancySeverityValue = "INFO" | "WARNING" | "ERROR" | "CRITICAL";

export type DiscrepancyResolutionStatusValue = "OPEN" | "RESOLVED";

export interface ReconciliationRunRecord {
  id: string;
  scope: ReconciliationScopeValue;
  status: ReconciliationRunStatusValue;
  startedAt: Date;
  completedAt: Date | null;
  durationMs: number | null;
  recordsInspected: number;
  discrepancyCount: number;
  errorMessage: string | null;
  parametersHash: string;
  triggeredByUserId: string | null;
  createdAt: Date;
}

export interface StartReconciliationRunData {
  id: string;
  scope: ReconciliationScopeValue;
  parametersHash: string;
  triggeredByUserId: string | null;
  startedAt: Date;
}

export interface CompleteReconciliationRunData {
  id: string;
  completedAt: Date;
  durationMs: number;
  recordsInspected: number;
  discrepancyCount: number;
}

export interface FailReconciliationRunData {
  id: string;
  completedAt: Date;
  durationMs: number;
  recordsInspected: number;
  errorMessage: string;
}

export interface ListReconciliationRunsOptions {
  limit: number;
  offset: number;
  status?: ReconciliationRunStatusValue;
}

export interface ReconciliationRunRepository {
  findById(id: string): Promise<ReconciliationRunRecord | null>;
  list(options: ListReconciliationRunsOptions): Promise<ReconciliationRunRecord[]>;
  start(data: StartReconciliationRunData): Promise<ReconciliationRunRecord>;
  complete(data: CompleteReconciliationRunData): Promise<ReconciliationRunRecord>;
  fail(data: FailReconciliationRunData): Promise<ReconciliationRunRecord>;
  /**
   * Module 81 — Reconciliation Admin Dashboard & Operations: a bounded
   * `COUNT(*)` (optionally filtered by status) for the admin overview's
   * "total runs" tile and the runs list's pagination — never a substitute
   * for `list`, which stays the only way rows themselves are read.
   */
  count(status?: ReconciliationRunStatusValue): Promise<number>;
}

export interface DiscrepancyResolutionRecord {
  resolvedByUserId: string;
  resolvedAt: Date;
  reason: string;
  metadata: Record<string, unknown> | null;
}

export interface ReconciliationDiscrepancyRecord {
  id: string;
  detectedByRunId: string;
  lastSeenRunId: string;
  entityType: DiscrepancyEntityTypeValue;
  entityId: string | null;
  jobId: string | null;
  paymentId: string | null;
  invoiceId: string | null;
  payoutId: string | null;
  refundId: string | null;
  creditNoteId: string | null;
  category: DiscrepancyCategoryValue;
  severity: DiscrepancySeverityValue;
  expectedValue: number | null;
  actualValue: number | null;
  differenceValue: number | null;
  currency: string | null;
  explanation: string;
  fingerprint: string;
  resolutionStatus: DiscrepancyResolutionStatusValue;
  resolution: DiscrepancyResolutionRecord | null;
  detectedAt: Date;
  updatedAt: Date;
}

export interface CreateDiscrepancyData {
  id: string;
  detectedByRunId: string;
  entityType: DiscrepancyEntityTypeValue;
  entityId: string | null;
  jobId: string | null;
  paymentId: string | null;
  invoiceId: string | null;
  payoutId: string | null;
  refundId: string | null;
  creditNoteId: string | null;
  category: DiscrepancyCategoryValue;
  severity: DiscrepancySeverityValue;
  expectedValue: number | null;
  actualValue: number | null;
  differenceValue: number | null;
  currency: string | null;
  explanation: string;
  fingerprint: string;
  detectedAt: Date;
}

export interface ResolveDiscrepancyData {
  id: string;
  resolvedByUserId: string;
  resolvedAt: Date;
  reason: string;
  metadata: Record<string, unknown> | null;
}

export interface ListDiscrepanciesForRunOptions {
  runId: string;
  limit: number;
  offset: number;
}

export interface ListUnresolvedDiscrepanciesOptions {
  limit: number;
  offset: number;
  minSeverity?: DiscrepancySeverityValue;
}

/**
 * Module 81 — Reconciliation Admin Dashboard & Operations: the general
 * discrepancy-investigation query the admin UI's filterable Discrepancies
 * table needs — `listForRun`/`listUnresolved` above each cover one fixed
 * shape (all discrepancies of one run; unresolved above a severity floor)
 * and neither lets an admin filter by resolution status + severity + type
 * + entity type + a detected-at date range at once, or list every
 * discrepancy regardless of run/resolution/severity for a broad
 * investigation. Server-side filtered and paginated for the same
 * bounded-query reason every option below is optional narrowing, never a
 * full-table scan.
 */
export interface ListDiscrepanciesOptions {
  limit: number;
  offset: number;
  resolutionStatus?: DiscrepancyResolutionStatusValue;
  severity?: DiscrepancySeverityValue;
  category?: DiscrepancyCategoryValue;
  entityType?: DiscrepancyEntityTypeValue;
  /** Inclusive lower bound on `detectedAt`. */
  detectedFrom?: Date;
  /** Inclusive upper bound on `detectedAt`. */
  detectedTo?: Date;
}

/** Module 81: per-severity counts of still-`OPEN` discrepancies — the
 *  admin overview's critical/high/medium/low severity tiles. Every
 *  `DiscrepancySeverityValue` is always present in the result (zero when
 *  there are none at that severity) so the caller never has to guard a
 *  missing key. */
export type OpenSeverityCounts = Record<DiscrepancySeverityValue, number>;

/** Module 81: `OPEN`-discrepancy counts grouped by `DiscrepancyCategoryValue`
 *  ("discrepancies by type" on the admin overview), sorted by count
 *  descending. Only categories with at least one open discrepancy appear. */
export interface CategoryCount {
  category: DiscrepancyCategoryValue;
  count: number;
}

export interface ReconciliationDiscrepancyRepository {
  findById(id: string): Promise<ReconciliationDiscrepancyRecord | null>;
  findOpenByFingerprint(fingerprint: string): Promise<ReconciliationDiscrepancyRecord | null>;
  listForRun(options: ListDiscrepanciesForRunOptions): Promise<ReconciliationDiscrepancyRecord[]>;
  listUnresolved(options: ListUnresolvedDiscrepanciesOptions): Promise<ReconciliationDiscrepancyRecord[]>;
  /** Module 81 — see `ListDiscrepanciesOptions`'s own doc comment. */
  list(options: ListDiscrepanciesOptions): Promise<ReconciliationDiscrepancyRecord[]>;
  createOrTouch(data: CreateDiscrepancyData): Promise<{ record: ReconciliationDiscrepancyRecord; created: boolean }>;
  resolve(data: ResolveDiscrepancyData): Promise<ReconciliationDiscrepancyRecord>;
  /** Module 81: total open vs. resolved counts — the admin overview's
   *  "unresolved discrepancies"/"resolved discrepancies" tiles. Two bounded
   *  `COUNT(*)` queries, never a row scan. */
  countByResolutionStatus(): Promise<{ open: number; resolved: number }>;
  /** Module 81 — see `OpenSeverityCounts`'s own doc comment. */
  getOpenSeverityCounts(): Promise<OpenSeverityCounts>;
  /** Module 81 — see `CategoryCount`'s own doc comment. */
  getOpenCategoryCounts(): Promise<CategoryCount[]>;
  /**
   * Module 81: severity breakdown for every discrepancy *detected by* one
   * specific run (`detectedByRunId`), regardless of current resolution
   * status — the run detail page's own "severity breakdown" section. Every
   * `DiscrepancySeverityValue` is always present (zero when absent), same
   * as `getOpenSeverityCounts`.
   */
  getSeverityCountsForRun(runId: string): Promise<OpenSeverityCounts>;
}
