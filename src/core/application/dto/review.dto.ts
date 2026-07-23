import { z } from "zod";

import { MAX_COMMENT_LENGTH, MAX_RATING, MIN_RATING } from "@/domain/services/review-rules";

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
  jobId: z.string().uuid("Invalid job."),
  rating: z.coerce
    .number()
    .int("Rating must be a whole number.")
    .min(MIN_RATING, `Rating must be at least ${MIN_RATING}.`)
    .max(MAX_RATING, `Rating must be at most ${MAX_RATING}.`),
  comment: z
    .string()
    .trim()
    .max(MAX_COMMENT_LENGTH, `Comment must be ${MAX_COMMENT_LENGTH} characters or fewer.`)
    .optional()
    .or(z.literal("")),
});
export type CreateReviewInput = z.infer<typeof createReviewSchema>;

export const listProfessionalReviewsSchema = z.object({
  professionalProfileId: z.string().uuid("Invalid professional."),
  limit: z.coerce.number().int().min(1).max(100).default(20),
  offset: z.coerce.number().int().min(0).default(0),
});
export type ListProfessionalReviewsInput = z.infer<typeof listProfessionalReviewsSchema>;
