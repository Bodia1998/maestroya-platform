import type {
  LeadPricingReviewDecision,
  LeadPricingReviewRecord,
  LeadPricingReviewStatus,
  OpenLeadPricingReviewInput,
} from "@/domain/services/lead-pricing-review";

/**
 * Module 164 — persistence port of lead pricing reviews (table `lead_pricing_reviews`).
 *
 * Invariants the implementation must keep (also enforced by the migration):
 *   - at most ONE row per (leadId, inputFingerprint), so `openOrGet` is idempotent and race-safe;
 *   - at most ONE PENDING_REVIEW row per lead;
 *   - a decided row is immutable (no second decision, no edit);
 *   - the decision is a status-conditional write: the first decision wins, a repeat of the SAME outcome is reported as the
 *     existing row, a different later outcome is refused.
 */
export interface LeadPricingReviewRepository {
  /** Returns the existing row for (leadId, inputFingerprint) or creates it PENDING_REVIEW. `created` is false for an existing row. */
  openOrGet(input: OpenLeadPricingReviewInput): Promise<{ review: LeadPricingReviewRecord; created: boolean }>;

  findByLeadAndFingerprint(leadId: string, inputFingerprint: string): Promise<LeadPricingReviewRecord | null>;

  findById(id: string): Promise<LeadPricingReviewRecord | null>;

  /** Newest first, bounded. */
  list(filter: { status: LeadPricingReviewStatus | null; limit: number; offset: number }): Promise<LeadPricingReviewRecord[]>;

  /**
   * PENDING_REVIEW -> APPROVED / REJECTED, conditional on the row still being pending. Returns the updated row, or null when the
   * row was not pending (someone else decided first, or it does not exist).
   */
  decide(id: string, decision: LeadPricingReviewDecision, actorUserId: string, decidedAt: Date): Promise<LeadPricingReviewRecord | null>;
}
