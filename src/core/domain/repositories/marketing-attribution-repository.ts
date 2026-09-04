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
   * Module 96 — Referral & Affiliate Production Wiring: the reverse
   * lookup of `linkUser` — resolves a registered `User.id` back to their
   * (frozen, write-once via `linkUser`) attribution row, if any. Added so
   * a real booking/payment lifecycle caller that only knows the paying
   * `User.id` (e.g. `Payment.payerId`) can still reach the visitor-keyed
   * attribution/conversion/affiliate-commission machinery without ever
   * needing to thread a `visitorId` through the entire booking/payment
   * flow. Returns `null` for a user who registered without ever being
   * tracked (direct signup, no cookie) — expected, not an error.
   */
  findByUserId(userId: string): Promise<MarketingAttributionRecord | null>;

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

  /**
   * Module 96 — Referral & Affiliate Production Wiring / GDPR erasure:
   * nulls `userId` on every attribution row currently linked to this
   * user — the one personal identifier this model carries. `visitorId`,
   * the referral codes, and every touch timestamp are deliberately left
   * untouched: they remain the referring partner's own aggregate
   * attribution/conversion history (see `REFERRAL_ATTRIBUTION`'s own
   * classification, `gdpr-privacy-rules.ts`) and carry no PII of their
   * own once unlinked from a `User`. Idempotent — a user with no linked
   * attribution row is a no-op, and a repeat call after the link is
   * already null does nothing further.
   */
  eraseForUser(userId: string): Promise<void>;
}
