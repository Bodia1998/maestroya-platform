import { z } from "zod";

import { MAX_COMMENT_LENGTH, MAX_RATING, MAX_RESPONSE_LENGTH, MIN_RATING } from "@/domain/services/review-rules";

/**
 * Reviews & Ratings module (Module 13). Same convention as job.dto.ts:
 * one schema shared by the client form/action caller and the Server Action
 * that receives it.
 *
 * Deliberately absent from `createReviewSchema`: `reviewerId`,
 * `professionalId`/`revieweeProfessionalProfileId`, and any Job-completion
 * flag — ownership, the reviewee, and eligibility are always derived
 * server-side from the authenticated session and the Job record itself
 * (see resolveJobActor and CreateReviewUseCase's own doc comment), never
 * accepted as client input. `jobId` itself *is* accepted (and re-verified
 * server-side against the caller's session) — same as `jobId` in
 * job.dto.ts: it identifies which resource the action targets, not a claim
 * of ownership over it.
 */

export const createReviewSchema = z.object({
  jobId: z.string().uuid("dto.ids.job"),
  rating: z.coerce
    .number()
    .int("dto.review.ratingInteger")
    .min(MIN_RATING, "tooSmall")
    .max(MAX_RATING, "tooBig"),
  comment: z
    .string()
    .trim()
    .max(MAX_COMMENT_LENGTH, "maxLength")
    .optional()
    .or(z.literal("")),
});
export type CreateReviewInput = z.infer<typeof createReviewSchema>;

export const listProfessionalReviewsSchema = z.object({
  professionalProfileId: z.string().uuid("dto.ids.professional"),
  limit: z.coerce.number().int().min(1).max(100).default(20),
  offset: z.coerce.number().int().min(0).default(0),
  // Module 41 — Reviews & Ratings: optional exact-rating filter (e.g. "show
  // only 5-star reviews"). Omitted (the default) returns every rating,
  // identical to this schema's pre-Module-41 behavior.
  rating: z.coerce.number().int().min(MIN_RATING).max(MAX_RATING).optional(),
});
export type ListProfessionalReviewsInput = z.infer<typeof listProfessionalReviewsSchema>;

/**
 * Module 41 — Reviews & Ratings: shares the exact same `rating`/`comment`
 * shape as `createReviewSchema` — an edit re-validates the identical
 * constraints a create does (UpdateReviewUseCase re-checks `isValidRating`
 * too, same "DTO boundary + use case" defense-in-depth convention as
 * `createReviewSchema`). `reviewId` identifies which review is being
 * edited, re-verified server-side against the caller's session inside
 * UpdateReviewUseCase — same "accepted as input, never trusted as proof of
 * ownership" convention as `jobId` above.
 */
export const updateReviewSchema = z.object({
  reviewId: z.string().uuid("dto.ids.review"),
  rating: z.coerce
    .number()
    .int("dto.review.ratingInteger")
    .min(MIN_RATING, "tooSmall")
    .max(MAX_RATING, "tooBig"),
  comment: z
    .string()
    .trim()
    .max(MAX_COMMENT_LENGTH, "maxLength")
    .optional()
    .or(z.literal("")),
});
export type UpdateReviewInput = z.infer<typeof updateReviewSchema>;

export const deleteReviewSchema = z.object({
  reviewId: z.string().uuid("dto.ids.review"),
});
export type DeleteReviewInput = z.infer<typeof deleteReviewSchema>;

/**
 * Module 41 — Reviews & Ratings: a professional's response. Deliberately
 * no `professionalId`/`revieweeProfessionalProfileId` field — the
 * respondent is always the authenticated caller, re-verified server-side
 * against the Review's own `revieweeProfessionalProfileId` inside
 * `RespondToReviewUseCase` (see that class's own doc comment) — same
 * "never client-suppliable" convention `createReviewSchema`'s own doc
 * comment describes for the reviewee.
 */
export const respondToReviewSchema = z.object({
  reviewId: z.string().uuid("dto.ids.review"),
  response: z
    .string()
    .trim()
    .min(1, "dto.review.responseEmpty")
    .max(MAX_RESPONSE_LENGTH, "maxLength"),
});
export type RespondToReviewInput = z.infer<typeof respondToReviewSchema>;
