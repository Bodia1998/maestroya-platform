import { z } from "zod";

/**
 * Module 80 — Financial Reconciliation & Observability.
 *
 * Same "shared by the Server Action boundary and the composed use case"
 * convention as every other `*.dto.ts` in this codebase (see
 * dispute.dto.ts's own doc comment). `triggeredByUserId` is never
 * accepted here — always derived server-side from the authenticated
 * admin session (see `admin/reconciliation/actions.ts`).
 */

const SCOPE_VALUES = [
  "FULL",
  "PAYMENT",
  "COMMISSION",
  "TAX",
  "INVOICE",
  "PAYOUT",
  "REFUND",
  "CREDIT_NOTE",
  "PROVIDER",
] as const;

export const startReconciliationRunSchema = z.object({
  scope: z.enum(SCOPE_VALUES).default("FULL"),
  /** Only inspect Jobs with financial activity on/after this date.
   *  Omit to scan the most recent `limit` jobs regardless of age. */
  since: z.coerce.date().optional(),
  /** Bounds a single run's cost — see `ReconciliationDataSource`'s own
   *  doc comment on why a run is a bounded scan, not an unbounded
   *  full-history sweep. */
  limit: z.number().int().min(1).max(2000).default(500),
});
export type StartReconciliationRunInput = z.infer<typeof startReconciliationRunSchema>;

export const getReconciliationRunSchema = z.object({
  runId: z.string().uuid(),
});

export const listDiscrepanciesForRunSchema = z.object({
  runId: z.string().uuid(),
  limit: z.number().int().min(1).max(200).default(50),
  offset: z.number().int().min(0).default(0),
});

const SEVERITY_VALUES = ["INFO", "WARNING", "ERROR", "CRITICAL"] as const;

export const listUnresolvedDiscrepanciesSchema = z.object({
  minSeverity: z.enum(SEVERITY_VALUES).default("ERROR"),
  limit: z.number().int().min(1).max(200).default(50),
  offset: z.number().int().min(0).default(0),
});

export const getDiscrepancySchema = z.object({
  discrepancyId: z.string().uuid(),
});

export const resolveDiscrepancySchema = z.object({
  discrepancyId: z.string().uuid(),
  reason: z.string().min(3).max(2000),
  metadata: z.record(z.string(), z.unknown()).optional(),
});
export type ResolveDiscrepancyInput = z.infer<typeof resolveDiscrepancySchema>;

export const getFinancialEntitySnapshotSchema = z.object({
  jobId: z.string().uuid(),
});

/**
 * Module 81 — Reconciliation Admin Dashboard & Operations.
 *
 * DTOs for the admin UI's read-only browsing surfaces (runs list,
 * discrepancies table, overview) — same "shared by the Server Action
 * boundary and the composed use case" convention as every schema above.
 * None of these accept anything that changes state; only `limit`/`offset`
 * bound how much this admin operator can pull server-side in one page.
 */
const RUN_STATUS_VALUES = ["RUNNING", "COMPLETED", "FAILED"] as const;

export const listReconciliationRunsSchema = z.object({
  status: z.enum(RUN_STATUS_VALUES).optional(),
  limit: z.number().int().min(1).max(100).default(20),
  offset: z.number().int().min(0).default(0),
});
export type ListReconciliationRunsInput = z.infer<typeof listReconciliationRunsSchema>;

export const RESOLUTION_STATUS_VALUES = ["OPEN", "RESOLVED"] as const;

export const ENTITY_TYPE_VALUES = [
  "PAYMENT",
  "COMMISSION",
  "TAX_BREAKDOWN",
  "INVOICE",
  "PAYOUT",
  "REFUND",
  "CREDIT_NOTE",
  "PROVIDER_EVENT",
] as const;

// Mirrors `DiscrepancyCategoryValue` in domain/repositories/reconciliation-repository.ts —
// same "duplicate the literal union as a DTO-local const array" convention SEVERITY_VALUES
// above already uses, since a Zod schema in the application layer can't import a bare
// TypeScript type as a runtime enum.
export const CATEGORY_VALUES = [
  "PAYMENT_MISSING_JOB_OR_QUOTE",
  "PAYMENT_AMOUNT_MISMATCH",
  "PAYMENT_SUCCESSFUL_WITHOUT_RELATIONSHIP",
  "DUPLICATE_PAYMENT",
  "PAYMENT_CURRENCY_MISMATCH",
  "COMMISSION_RATE_MISMATCH",
  "COMMISSION_AMOUNT_MISMATCH",
  "COMMISSION_PROFESSIONAL_NET_MISMATCH",
  "COMMISSION_ALLOCATION_MISMATCH",
  "COMMISSION_LEDGER_INCONSISTENT",
  "TAX_TAXABLE_BASE_MISMATCH",
  "TAX_RATE_MISMATCH",
  "TAX_AMOUNT_MISMATCH",
  "TAX_PROFESSIONAL_SIDE_MISMATCH",
  "TAX_CUSTOMER_SIDE_MISMATCH",
  "TAX_IRPF_MISMATCH",
  "TAX_INVOICE_TOTAL_MISMATCH",
  "INVOICE_INVALID_JOB_REFERENCE",
  "INVOICE_WRONG_PARTY",
  "INVOICE_AMOUNT_INCONSISTENT_WITH_TAX_BREAKDOWN",
  "INVOICE_TAX_AMOUNT_INCONSISTENT",
  "INVOICE_COMMISSION_AMOUNT_INCONSISTENT",
  "INVOICE_ISSUED_WITHOUT_PREREQUISITES",
  "INVOICE_PAID_WITHOUT_PAYOUT",
  "DUPLICATE_ACTIVE_INVOICE",
  "INVOICE_NUMBERING_ANOMALY",
  "INVOICE_MISSING_IMMUTABLE_METADATA",
  "INVOICE_CREDIT_NOTE_INCONSISTENT",
  "PAYOUT_MISSING_ELIGIBLE_RELATIONSHIP",
  "PAYOUT_AMOUNT_MISMATCH",
  "PAYOUT_EXCEEDS_PAYABLE_AMOUNT",
  "PAYOUT_MISSING_REQUIRED_INVOICE_STATE",
  "DUPLICATE_PAYOUT",
  "PAYOUT_CURRENCY_MISMATCH",
  "PAYOUT_PROVIDER_REFERENCE_MISMATCH",
  "REFUND_EXCEEDS_REFUNDABLE_AMOUNT",
  "DUPLICATE_REFUND",
  "REFUND_AMOUNT_OR_CURRENCY_MISMATCH",
  "REFUND_MISSING_PAYMENT_RELATIONSHIP",
  "REFUND_STATE_INCONSISTENT_WITH_PAYMENT",
  "REFUND_CREDIT_NOTE_INCONSISTENT",
  "CREDIT_NOTE_INVALID_INVOICE_REFERENCE",
  "CREDIT_NOTE_WRONG_PARTY",
  "CREDIT_NOTE_EXCEEDS_REMAINING_CREDITABLE_AMOUNT",
  "CREDIT_NOTE_TAX_REVERSAL_MISMATCH",
  "CREDIT_NOTE_ISSUED_WITHOUT_REQUIRED_STATE",
  "DUPLICATE_CREDIT_NOTE",
  "CREDIT_NOTE_NUMBERING_ANOMALY",
  "CREDIT_NOTE_AMOUNT_OR_CURRENCY_MISMATCH",
  "PROVIDER_STATE_UNKNOWN",
  "PROVIDER_LOCAL_STATE_MISMATCH",
  "PROVIDER_AMOUNT_MISMATCH",
] as const;

export const listDiscrepanciesSchema = z.object({
  resolutionStatus: z.enum(RESOLUTION_STATUS_VALUES).optional(),
  severity: z.enum(SEVERITY_VALUES).optional(),
  category: z.enum(CATEGORY_VALUES).optional(),
  entityType: z.enum(ENTITY_TYPE_VALUES).optional(),
  detectedFrom: z.coerce.date().optional(),
  detectedTo: z.coerce.date().optional(),
  limit: z.number().int().min(1).max(100).default(20),
  offset: z.number().int().min(0).default(0),
});
export type ListDiscrepanciesInput = z.infer<typeof listDiscrepanciesSchema>;
