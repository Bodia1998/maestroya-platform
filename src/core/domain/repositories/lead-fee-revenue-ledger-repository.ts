import type {
  LeadFeeLedgerEntryType,
  LeadFeeRevenueLedgerEntryData,
  LeadFeeRevenueLedgerEntryRecord,
} from "@/domain/services/lead-fee-revenue-ledger";

/**
 * Module 149 — persistence port of the append-only lead-fee revenue ledger.
 *
 * There is deliberately no update/delete: entries are immutable (DB trigger). The ONLY writer in the
 * confirmation flow is the lead-purchase repository's CONFIRMED transition given a ledger source, which inserts the
 * entry in the same DB transaction as PENDING_PAYMENT -> CONFIRMED. `recordIfAbsent` is the idempotent
 * path for a purchase that is already CONFIRMED when a verified success event is reprocessed.
 */
export interface LeadFeeRevenueLedgerRepository {
  /**
   * Inserts the entry unless one already exists for (leadPurchaseId, entryType) — atomic, safe under
   * concurrency (ON CONFLICT DO NOTHING + re-read). `created` is true only for the caller that wrote.
   * Throws LeadFeeLedgerConflictError when an existing entry disagrees with `entry` (never overwritten);
   * any database error propagates (never swallowed).
   */
  recordIfAbsent(entry: LeadFeeRevenueLedgerEntryData): Promise<{ created: boolean; entry: LeadFeeRevenueLedgerEntryRecord }>;
  findByLeadPurchaseId(leadPurchaseId: string, entryType?: LeadFeeLedgerEntryType): Promise<LeadFeeRevenueLedgerEntryRecord | null>;
}
