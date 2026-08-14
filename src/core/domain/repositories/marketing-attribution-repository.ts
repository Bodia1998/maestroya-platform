import type { AttributionTouchState } from "@/domain/services/marketing-attribution-touch-rules";

/**
 * Module 60 — Referral & Marketing Attribution Platform: repository
 * interface for `MarketingAttribution` — one row per visitor
 * (`visitorId` unique), holding write-once first-touch and
 * always-overwritten last-touch attribution, plus the optional link to the
 * `User` this visitor eventually registered as.
 */
export interface MarketingAttributionRecord extends AttributionTouchState {
  id: string;
  visitorId: string;
  userId: string | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface RegistrationSplitStat {
  professionalRegistrations: number;
  clientRegistrations: number;
  unknownIntentRegistrations: number;
}

export interface MarketingAttributionRepository {
  findByVisitorId(visitorId: string): Promise<MarketingAttributionRecord | null>;

  /**
   * Persists `state` for `visitorId` — creates the row if this is the
   * visitor's first-ever touch, otherwise updates it. The caller
   * (`TrackVisitUseCase`) is responsible for computing `state` via
   * `applyAttributionTouch` first; this method does no first/last-touch
   * decision-making of its own, only persistence — same "pure domain
   * function decides, repository persists what it's told" split every
   * other repository in this codebase follows.
   */
  upsertTouchState(visitorId: string, state: AttributionTouchState): Promise<MarketingAttributionRecord>;

  /**
   * Best-effort, idempotent: sets `userId` on the visitor's attribution row
   * if one exists and doesn't already have a `userId`. A no-op (never
   * throws) when no attribution row exists for `visitorId` — a user who
   * registers without ever having been tracked (direct signup, no cookie)
   * simply has no attribution to link, which is expected and not an error.
   */
  linkUser(visitorId: string, userId: string): Promise<void>;

  countTotal(): Promise<number>;
  countWithUser(): Promise<number>;

  /**
   * Module 61 — Affiliate & Partner System: every attribution whose
   * `firstReferralCode` or `lastReferralCode` is one of `codes` — lets
   * `GetPartnerDashboardStatisticsUseCase` walk from "a partner's referral
   * codes" to "every visitor ever attributed to one of them" and from
   * there to their `ConversionEvent`s (via the existing
   * `ConversionEventRepository.listByAttributionId`), all without a new
   * `partnerId` column anywhere in Module 60's schema. Returns `[]` for an
   * empty `codes` array.
   */
  listByReferralCodes(codes: string[]): Promise<MarketingAttributionRecord[]>;
}
