/**
 * Module 65 — Trust & Integrity System: fake-review / review-ring detection
 * rule engine. Pure predicates over caller-supplied review data — this file
 * never queries `ReviewRepository` itself, same "caller fetches, this file
 * only decides" split every other Module 65 rule engine follows.
 */

export interface ReviewerActivityInput {
  reviewerUserId: string;
  /** Reviews this user has written within the lookback window used by the
   *  caller (e.g. 24h) — a burst of reviews from one author is the
   *  "repeated reviewer" signal named in the module brief. */
  reviewsInWindow: number;
  /** How many of those reviews target professionals the reviewer has no
   *  completed Job with — a review with no underlying transaction is the
   *  strongest single fake-review signal this engine models. */
  reviewsWithoutCompletedJob: number;
}

export const REVIEWER_BURST_THRESHOLD = 5;

export interface ReviewRingCandidate {
  /** Two users are a review-ring candidate when they review each other
   *  reciprocally an unusual number of times — `reviewerUserId` reviewing
   *  `revieweeUserId` and vice versa. */
  reviewerUserId: string;
  revieweeUserId: string;
  reciprocalReviewCount: number;
}

export const RECIPROCAL_REVIEW_RING_THRESHOLD = 3;

export interface FakeReviewFinding {
  reason: "REVIEWER_BURST" | "REVIEW_WITHOUT_TRANSACTION" | "REVIEW_RING";
  involvedUserIds: string[];
  detail: string;
}

/** Requirement #9 — "suspicious review behaviour": a single author posting
 *  an implausible number of reviews in a short window. */
export function detectReviewerBurst(input: ReviewerActivityInput): FakeReviewFinding | null {
  if (input.reviewsInWindow < REVIEWER_BURST_THRESHOLD) return null;
  return {
    reason: "REVIEWER_BURST",
    involvedUserIds: [input.reviewerUserId],
    detail: `${input.reviewsInWindow} reviews posted by the same author within the detection window (threshold ${REVIEWER_BURST_THRESHOLD}).`,
  };
}

/** Requirement #9 — a review with no underlying completed Job is
 *  structurally impossible to have formed a genuine opinion from. */
export function detectReviewsWithoutTransaction(input: ReviewerActivityInput): FakeReviewFinding | null {
  if (input.reviewsWithoutCompletedJob <= 0) return null;
  return {
    reason: "REVIEW_WITHOUT_TRANSACTION",
    involvedUserIds: [input.reviewerUserId],
    detail: `${input.reviewsWithoutCompletedJob} review(s) written for a professional with no completed Job between the two users.`,
  };
}

/** Requirement #9 — "review rings": a pair of accounts reviewing each
 *  other back and forth well beyond what an organic two-sided marketplace
 *  relationship produces. */
export function detectReviewRing(candidate: ReviewRingCandidate): FakeReviewFinding | null {
  if (candidate.reciprocalReviewCount < RECIPROCAL_REVIEW_RING_THRESHOLD) return null;
  return {
    reason: "REVIEW_RING",
    involvedUserIds: [candidate.reviewerUserId, candidate.revieweeUserId],
    detail: `${candidate.reciprocalReviewCount} reciprocal reviews exchanged between two accounts (threshold ${RECIPROCAL_REVIEW_RING_THRESHOLD}).`,
  };
}
