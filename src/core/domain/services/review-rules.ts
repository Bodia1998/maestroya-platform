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

/**
 * Reviews & Ratings module (Module 41): the small set of additional pure
 * rules the lifecycle/response features need, kept in this same
 * dependency-free file rather than a second review-lifecycle-rules.ts —
 * this file is already the one canonical place Review's business rules
 * live (see this file's top doc comment), and these rules are just as
 * small/self-contained as the Module 13 ones above.
 */

/**
 * A review may be edited by its author for a limited window after
 * creation — long enough to fix a typo or reconsider a rating shortly
 * after submitting, short enough that a review can't be silently rewritten
 * long after the professional (and the public) have already relied on it.
 * A named, adjustable constant (hours, not days) — same "one place, not a
 * magic number scattered across use cases" convention as
 * DISPUTE_WINDOW_DAYS in dispute-rules.ts.
 */
export const REVIEW_EDIT_WINDOW_HOURS = 72;

/**
 * Whether `createdAt` is still within the edit window, evaluated against
 * `now` (always the real clock at the use case boundary, passed in rather
 * than read here so this stays a pure function — same convention as
 * isWithinDisputeWindow in dispute-rules.ts).
 */
export function isWithinReviewEditWindow(createdAt: Date, now: Date): boolean {
  const elapsedMs = now.getTime() - createdAt.getTime();
  return elapsedMs >= 0 && elapsedMs <= REVIEW_EDIT_WINDOW_HOURS * 60 * 60 * 1000;
}

export const MAX_RESPONSE_LENGTH = 2000;

/**
 * Trims a professional's response and normalizes a whitespace-only or
 * empty string to `null` — mirrors normalizeComment's own contract exactly
 * (a response, like a comment, is optional written text with the same
 * "empty means none" semantics), kept as a separate named function rather
 * than reusing normalizeComment directly so each call site's intent (review
 * comment vs. professional response) stays self-documenting at the call
 * site and the two can diverge independently later without one silently
 * changing the other's behavior.
 */
export function normalizeResponse(response: string | null | undefined): string | null {
  if (response === null || response === undefined) return null;
  const trimmed = response.trim();
  return trimmed.length === 0 ? null : trimmed;
}

/** The full 1–5 rating scale, used to build a zero-filled rating
 *  distribution before folding in real counts — so a rating with zero
 *  reviews still appears in the distribution as `0`, not as a missing key
 *  a consumer would have to special-case. */
export const RATING_SCALE: readonly number[] = [1, 2, 3, 4, 5];

export type RatingDistribution = Record<1 | 2 | 3 | 4 | 5, number>;

export function emptyRatingDistribution(): RatingDistribution {
  return { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0 };
}
