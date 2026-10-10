import type { LeadFeeReconciliationSnapshot } from "@/domain/services/lead-fee-document-reconciliation";

/**
 * Module 152 — read-only port for the lead-fee document reconciliation.
 *
 * Deliberately a single query-only method: there is no write, update, delete or "mark resolved" capability anywhere on this
 * port. The returned snapshot MUST be internally consistent (all three document tables read at one point in time); an
 * implementation that cannot read everything within its configured limit throws LeadFeeReconciliationScopeTooLargeError
 * instead of returning a partial snapshot. It reads the M149 ledger, M150 invoices, M151 credit notes and the status of the
 * ledger entries' lead purchases — nothing else (no billing identity, no job value, no provider data).
 */
export interface LeadFeeDocumentReconciliationReader {
  readSnapshot(): Promise<LeadFeeReconciliationSnapshot>;
}
