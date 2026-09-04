/**
 * Module 96 — Referral & Affiliate Production Wiring: repository
 * interface for `AffiliateCommissionReversal` — the append-only ledger of
 * every refund/chargeback-driven reversal applied against an
 * `AffiliateCommission`. Mirrors `FinancialLedgerRepository`'s own
 * "immutable by construction — this interface exposes no update/delete
 * method" convention exactly.
 */
export const AFFILIATE_COMMISSION_REVERSAL_TYPE_VALUES = ["FULL", "PARTIAL"] as const;
export type AffiliateCommissionReversalTypeValue = (typeof AFFILIATE_COMMISSION_REVERSAL_TYPE_VALUES)[number];

export interface AffiliateCommissionReversalRecord {
  id: string;
  affiliateCommissionId: string;
  amount: number;
  type: AffiliateCommissionReversalTypeValue;
  /** Module 77 `FinancialAdjustment.id` this reversal was derived from —
   *  the idempotency anchor. */
  financialAdjustmentId: string;
  reason: string | null;
  createdAt: Date;
}

export interface CreateAffiliateCommissionReversalData {
  affiliateCommissionId: string;
  amount: number;
  type: AffiliateCommissionReversalTypeValue;
  financialAdjustmentId: string;
  reason: string | null;
}

export interface AffiliateCommissionReversalRepository {
  /**
   * Insert-or-return-existing, keyed on `financialAdjustmentId`'s
   * database-level unique constraint — mirrors `RefundRepository.
   * createPending`'s own "insert first, let the database's own uniqueness
   * constraint be the single source of truth" convention exactly. Two
   * concurrent/duplicate reversal attempts for the same
   * `financialAdjustmentId` must both receive the SAME row back, never
   * two, and the caller can tell which happened via the returned row's
   * `id` already existing in its own prior state.
   */
  createIfNotExists(data: CreateAffiliateCommissionReversalData): Promise<AffiliateCommissionReversalRecord>;
  findByFinancialAdjustmentId(financialAdjustmentId: string): Promise<AffiliateCommissionReversalRecord | null>;
  listForAffiliateCommission(affiliateCommissionId: string): Promise<AffiliateCommissionReversalRecord[]>;
  sumForAffiliateCommission(affiliateCommissionId: string): Promise<number>;
}
