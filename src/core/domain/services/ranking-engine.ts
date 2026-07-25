/**
 * Search & Ranking module (Module 19) — the ranking/scoring engine.
 *
 * Pure domain service: no Prisma, no HTTP, no I/O. Takes a fully-resolved
 * set of signals (already computed by the application layer from
 * repository data) and produces a deterministic score plus a list of
 * customer-safe, human-readable reasons explaining the result — never a
 * numeric score exposed to the client (see docs/MODULE_19_SEARCH_RANKING.md,
 * "Ranking Transparency").
 *
 * ---------------------------------------------------------------------------
 * SCORING MODEL
 * ---------------------------------------------------------------------------
 * SearchResultScore =
 *     categoryMatchScore        (0 or CATEGORY_MATCH)
 *   + textRelevanceScore        (0..TEXT_RELEVANCE, scaled by query overlap)
 *   + locationScore             (0, SAME_PROVINCE, or EXACT_CITY)
 *   + verificationScore         (0 or VERIFICATION)
 *   + ratingScore               (0..RATING, scaled by Bayesian rating)
 *   + reviewVolumeScore         (0..REVIEW_VOLUME, scaled, capped, diminishing)
 *   + portfolioScore            (0..PORTFOLIO, scaled, capped)
 *   + profileCompletenessScore  (0..PROFILE_COMPLETENESS, scaled by fraction)
 *   + recencyScore              (0..RECENCY, decaying with account age)
 *
 * Every weight below is a named constant specifically so this formula can
 * be tuned later without touching any calling code — see
 * docs/MODULE_19_SEARCH_RANKING.md, "Ranking Weights" for the rationale
 * behind each value.
 */
import { computeBayesianRating } from "@/domain/services/bayesian-rating";
import type { LocationMatch } from "@/domain/services/location-match";

export const RANKING_WEIGHTS = {
  CATEGORY_MATCH: 20,
  TEXT_RELEVANCE: 20,
  LOCATION_EXACT_CITY: 20,
  LOCATION_SAME_PROVINCE: 10,
  VERIFICATION: 15,
  RATING: 15,
  REVIEW_VOLUME: 5,
  PORTFOLIO: 5,
  PROFILE_COMPLETENESS: 5,
  RECENCY: 5,
} as const;

/** Rating scale used across the platform (Review.rating is 1–5). */
const RATING_SCALE_MIN = 1;
const RATING_SCALE_MAX = 5;

/** Review count above which additional reviews stop adding to the score —
 *  prevents an outlier with thousands of reviews from crowding out every
 *  other signal. */
const REVIEW_VOLUME_CAP = 50;

/** Portfolio items above which additional items stop adding to the score —
 *  ranking rewards "has a real portfolio", not "uploaded the most items". */
const PORTFOLIO_ITEM_CAP = 5;

/** A candidate's account age (in days) past which the recency bonus fully
 *  decays to zero. Recency is a small tie-breaking nudge for newly active
 *  professionals/companies, not a dominant signal. */
const RECENCY_DECAY_DAYS = 90;

export interface RankingSignals {
  /** True when the candidate offers the searched category, or when no
   *  category filter was supplied at all (in which case every candidate is
   *  treated as matching — an absent filter should never penalize anyone). */
  categoryMatch: boolean;
  /** [0, 1] — see text-relevance.ts. Zero when no query was supplied. */
  textRelevance: number;
  locationMatch: LocationMatch;
  isVerified: boolean;
  averageRating: number | null;
  reviewCount: number;
  portfolioItemCount: number;
  /** [0, 1] — see profile-completeness.ts. */
  profileCompleteness: number;
  /** Used only to derive the recency signal; never returned or exposed. */
  createdAt: Date;
  /** Injected for testability instead of calling `new Date()` internally —
   *  every unit test can pin "now" and get a fully deterministic result. */
  now: Date;
}

export interface RankingScoreBreakdown {
  categoryMatchScore: number;
  textRelevanceScore: number;
  locationScore: number;
  verificationScore: number;
  ratingScore: number;
  reviewVolumeScore: number;
  portfolioScore: number;
  profileCompletenessScore: number;
  recencyScore: number;
}

export interface RankingScore {
  total: number;
  breakdown: RankingScoreBreakdown;
  /** Customer-safe, human-readable explanation of why this result ranked
   *  where it did. Order is significant (most-impactful reason first) and
   *  deterministic for a given set of signals. */
  reasons: string[];
}

function clamp01(value: number): number {
  return Math.min(1, Math.max(0, value));
}

function locationScore(match: LocationMatch): number {
  if (match === "EXACT_CITY") return RANKING_WEIGHTS.LOCATION_EXACT_CITY;
  if (match === "SAME_PROVINCE") return RANKING_WEIGHTS.LOCATION_SAME_PROVINCE;
  return 0;
}

function recencyScore(createdAt: Date, now: Date): number {
  const ageDays = (now.getTime() - createdAt.getTime()) / (1000 * 60 * 60 * 24);
  if (ageDays <= 0) return RANKING_WEIGHTS.RECENCY;
  if (ageDays >= RECENCY_DECAY_DAYS) return 0;
  const fraction = 1 - ageDays / RECENCY_DECAY_DAYS;
  return RANKING_WEIGHTS.RECENCY * fraction;
}

/**
 * Scores one candidate. Deterministic: identical `RankingSignals` always
 * produce an identical `RankingScore` — no randomness, no hidden clock
 * reads (`now` is a required input, not `Date.now()`).
 */
export function scoreCandidate(signals: RankingSignals): RankingScore {
  const bayesianRating = computeBayesianRating({
    averageRating: signals.averageRating,
    reviewCount: signals.reviewCount,
  });
  const normalizedRating = clamp01(
    (bayesianRating - RATING_SCALE_MIN) / (RATING_SCALE_MAX - RATING_SCALE_MIN),
  );

  const breakdown: RankingScoreBreakdown = {
    categoryMatchScore: signals.categoryMatch ? RANKING_WEIGHTS.CATEGORY_MATCH : 0,
    textRelevanceScore: clamp01(signals.textRelevance) * RANKING_WEIGHTS.TEXT_RELEVANCE,
    locationScore: locationScore(signals.locationMatch),
    verificationScore: signals.isVerified ? RANKING_WEIGHTS.VERIFICATION : 0,
    ratingScore: normalizedRating * RANKING_WEIGHTS.RATING,
    reviewVolumeScore:
      (Math.min(signals.reviewCount, REVIEW_VOLUME_CAP) / REVIEW_VOLUME_CAP) * RANKING_WEIGHTS.REVIEW_VOLUME,
    portfolioScore:
      (Math.min(signals.portfolioItemCount, PORTFOLIO_ITEM_CAP) / PORTFOLIO_ITEM_CAP) * RANKING_WEIGHTS.PORTFOLIO,
    profileCompletenessScore: clamp01(signals.profileCompleteness) * RANKING_WEIGHTS.PROFILE_COMPLETENESS,
    recencyScore: recencyScore(signals.createdAt, signals.now),
  };

  const total = Object.values(breakdown).reduce((sum, value) => sum + value, 0);

  return { total, breakdown, reasons: buildReasons(signals, breakdown, bayesianRating) };
}

/**
 * Builds the customer-safe explanation list. Each reason is gated behind a
 * threshold on its own contribution so a marginal signal (e.g. one old
 * portfolio item) doesn't get announced as if it were a strength.
 */
function buildReasons(
  signals: RankingSignals,
  breakdown: RankingScoreBreakdown,
  bayesianRating: number,
): string[] {
  const reasons: string[] = [];

  if (signals.isVerified) {
    reasons.push("Verified professional");
  }
  if (breakdown.ratingScore > 0 && signals.reviewCount > 0 && bayesianRating >= 4) {
    reasons.push(`Highly rated (${bayesianRating.toFixed(1)}/5 from ${signals.reviewCount} review${signals.reviewCount === 1 ? "" : "s"})`);
  }
  if (signals.reviewCount >= REVIEW_VOLUME_CAP) {
    reasons.push("Many completed jobs");
  }
  if (signals.locationMatch === "EXACT_CITY") {
    reasons.push("Located in the requested city");
  } else if (signals.locationMatch === "SAME_PROVINCE") {
    reasons.push("Located in the requested region");
  }
  if (signals.categoryMatch) {
    reasons.push("Matches the requested service category");
  }
  if (signals.portfolioItemCount > 0) {
    reasons.push(`Portfolio available (${signals.portfolioItemCount} item${signals.portfolioItemCount === 1 ? "" : "s"})`);
  }
  if (signals.profileCompleteness >= 0.85) {
    reasons.push("Strong, complete profile");
  }

  return reasons;
}
