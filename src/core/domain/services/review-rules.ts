/**
 * Reviews & Ratings module (Module 13): pure, dependency-free business
 * rules for the Review aggregate — same small-helper style as
 * job-state.ts/quote-state.ts/money.ts, kept independently unit-testable
 * and with exactly one definition rather than scattered `if` checks across
 * use cases.
 */

export const MIN_RATING = 1;
export const MAX_RATING = 5;

/** 1–5 inclusive, integer only. Mirrors the CHECK constraint enforced at
 *  the DB level (`reviews_rating_range_check`) — this is the same rule,
 *  checked earlier (at the application boundary) so a bad rating never
 *  reaches the database at all. */
export function isValidRating(rating: number): boolean {
  return Number.isInteger(rating) && rating >= MIN_RATING && rating <= MAX_RATING;
}

export const MAX_COMMENT_LENGTH = 2000;

/**
 * Trims a review comment and normalizes a whitespace-only or empty string
 * to `null` ("no comment"), mirroring the "optional written comment" rule.
 * Does not enforce the max length here — that's a validation-boundary
 * concern (see review.dto.ts, same split as quote.dto.ts's length checks
 * living in the schema rather than in domain/services/money.ts).
 */
export function normalizeComment(comment: string | null | undefined): string | null {
  if (comment === null || comment === undefined) return null;
  const trimmed = comment.trim();
  return trimmed.length === 0 ? null : trimmed;
}
