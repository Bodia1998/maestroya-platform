/**
 * Search & Ranking module (Module 19) — confidence-adjusted rating.
 *
 * A professional/company with a single 5-star review should not automatically
 * outrank one with hundreds of solid 4.7-star reviews. This module implements
 * a Bayesian average (a standard "weighted rating" technique, the same shape
 * IMDb's public rating formula uses) that pulls a review-count-scarce rating
 * toward a neutral prior mean until enough reviews accumulate to trust it.
 *
 * Formula:
 *   bayesianRating = (priorWeight * priorMean + reviewCount * averageRating)
 *                     / (priorWeight * reviewCount)
 *
 * `priorWeight` is "how many reviews worth of skepticism" to apply — with the
 * default of 10, a professional with 1 review at 5.0 stars scores close to
 * the prior (3.5), while a professional with 100 reviews at 4.8 stars scores
 * very close to their true 4.8 average, exactly the intended damping effect.
 *
 * Deliberately a pure, dependency-free function — no Prisma, no I/O — so it
 * stays independently unit-testable and reusable from both the ranking
 * engine and any future admin-facing analytics.
 */
export interface BayesianRatingInput {
  averageRating: number | null;
  reviewCount: number;
  /** Neutral rating assumed for a candidate with zero reviews. Defaults to
   *  the midpoint of the 1–5 scale. */
  priorMean?: number;
  /** How many "phantom" reviews at `priorMean` to blend in. Higher values
   *  require more real reviews before the raw average is trusted. */
  priorWeight?: number;
}

const DEFAULT_PRIOR_MEAN = 3.5;
const DEFAULT_PRIOR_WEIGHT = 10;

/**
 * Returns a confidence-adjusted rating on the same 1–5 scale as the raw
 * average. Always defined (never null) — a candidate with no reviews at all
 * still receives the prior mean, which is the intended "unproven, so assume
 * average" behavior rather than treating them as unrated.
 */
export function computeBayesianRating(input: BayesianRatingInput): number {
  const priorMean = input.priorMean ?? DEFAULT_PRIOR_MEAN;
  const priorWeight = input.priorWeight ?? DEFAULT_PRIOR_WEIGHT;
  const reviewCount = Math.max(0, input.reviewCount);
  const averageRating = input.averageRating ?? 0;

  if (reviewCount <= 0) return priorMean;

  const numerator = priorWeight * priorMean + reviewCount * averageRating;
  const denominator = priorWeight + reviewCount;

  return numerator / denominator;
}
