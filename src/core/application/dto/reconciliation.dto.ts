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

export const resolveDiscrepancySchema = z.object({
  discrepancyId: z.string().uuid(),
  reason: z.string().min(3).max(2000),
  metadata: z.record(z.string(), z.unknown()).optional(),
});
export type ResolveDiscrepancyInput = z.infer<typeof resolveDiscrepancySchema>;

export const getFinancialEntitySnapshotSchema = z.object({
  jobId: z.string().uuid(),
});
