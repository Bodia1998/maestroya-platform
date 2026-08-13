/**
 * Module 60 — Referral & Marketing Attribution Platform: pure click/visit
 * dedup rule. A pixel/analytics double-fire, a page double-load, or a
 * back-button re-render can all legitimately re-trigger the tracking
 * endpoint for the exact same visit within milliseconds of each other —
 * without a dedup rule every one of those would inflate the visit count
 * and (worse) call `MarketingAttributionRepository`'s "last touch" update
 * repeatedly for a single real visit.
 *
 * Window: 60 seconds.
 *  - Long enough to absorb the double-fire cases above — those all happen
 *    within at most a few seconds of the original request, so 60s leaves
 *    generous margin even under slow-network conditions.
 *  - Short enough that a genuine second visit minutes later (the visitor
 *    left and came back, or clicked the same link again from a different
 *    tab later in the session) is never silently suppressed and undercounted.
 *
 * Deliberately a pure function over an already-fetched visit history, not
 * a live DB query — `TrackVisitUseCase` queries
 * `ReferralVisitRepository.findRecentByVisitor` first, then calls this
 * function, the same "use case fetches, domain function decides" split
 * `findExpirable`/`isDuplicateVisit`-shaped rules use elsewhere in this
 * codebase (e.g. verification-expiration-rules.ts).
 */
export const VISIT_DEDUP_WINDOW_MS = 60_000;

export interface VisitSignature {
  visitorId: string;
  referralCode: string | null;
  utmSource: string | null;
  utmMedium: string | null;
  utmCampaign: string | null;
  landingPage: string;
  createdAt: Date;
}

/**
 * A candidate visit is a duplicate of one of `recentVisits` when all of
 * (visitorId, referralCode, utm signature, landingPage) match exactly and
 * the two timestamps fall within `VISIT_DEDUP_WINDOW_MS` of each other —
 * intentionally strict equality on every field (not "same referral code
 * only") so a visitor who follows two different campaign links within the
 * same minute is still counted as two distinct visits.
 */
export function isDuplicateVisit(candidate: VisitSignature, recentVisits: readonly VisitSignature[]): boolean {
  return recentVisits.some(
    (visit) =>
      visit.visitorId === candidate.visitorId &&
      visit.referralCode === candidate.referralCode &&
      visit.utmSource === candidate.utmSource &&
      visit.utmMedium === candidate.utmMedium &&
      visit.utmCampaign === candidate.utmCampaign &&
      visit.landingPage === candidate.landingPage &&
      Math.abs(candidate.createdAt.getTime() - visit.createdAt.getTime()) <= VISIT_DEDUP_WINDOW_MS,
  );
}
