"use server";

import { revalidatePath } from "next/cache";

import { createReviewSchema, deleteReviewSchema, respondToReviewSchema, updateReviewSchema } from "@/application/dto/review.dto";
import {
  makeCreateReviewUseCase,
  makeDeleteReviewUseCase,
  makeRespondToReviewUseCase,
  makeUpdateReviewUseCase,
} from "@/application/use-cases/review/compose";
import { makeAntiAbuseService } from "@/application/use-cases/security/compose";
import { DomainError } from "@/domain/errors/domain-error";
import { requireAuth } from "@/infrastructure/auth/rbac";

export type ActionResult = { success: true } | { success: false; error: string };

// Same translation convention as every other module's actions.ts (see
// jobs/actions.ts): domain errors surface their own safe, user-facing
// message; anything else is logged server-side and replaced with a
// generic one.
function fromDomainError(error: unknown, fallback: string): ActionResult {
  if (error instanceof DomainError) {
    return { success: false, error: error.message };
  }
  console.error(error);
  return { success: false, error: fallback };
}

/**
 * Reviews & Ratings module (Module 13): thin Server Action adapter — all
 * business logic (Job-completion prerequisite, customer-ownership
 * authorization, duplicate-review rejection, deriving the reviewee from
 * the Job) lives in CreateReviewUseCase, never here. `jobId` is always
 * re-verified server-side against the caller's session inside the use
 * case; it is never trusted as proof of ownership just because it was
 * passed in.
 */
/**
 * Review abuse (Module 24, threat E) — repeated-review flooding by a
 * single user across many jobs. Self-review and one-review-per-job are
 * already structurally impossible (Review.jobId is unique and
 * CreateReviewUseCase requires the caller to be that job's customer — see
 * its own doc comment); this adds the remaining frequency guard.
 */
export async function createReviewAction(jobId: string, rating: number, comment: string): Promise<ActionResult> {
  const user = await requireAuth();
  const parsed = createReviewSchema.safeParse({ jobId, rating, comment });
  if (!parsed.success) {
    return { success: false, error: parsed.error.issues[0]?.message ?? "Invalid review." };
  }

  const antiAbuse = makeAntiAbuseService();
  try {
    await antiAbuse.assertNotBlocked(user.id);
    await antiAbuse.enforceRateLimit("REVIEW_CREATE_BY_USER", { userId: user.id }, "REVIEW_RATE_LIMITED");
  } catch (error) {
    if (error instanceof DomainError) {
      return { success: false, error: error.message };
    }
    throw error;
  }

  try {
    await makeCreateReviewUseCase().execute(user.id, {
      jobId: parsed.data.jobId,
      rating: parsed.data.rating,
      comment: parsed.data.comment ? parsed.data.comment : null,
    });
    revalidatePath(`/jobs/${jobId}`);
    revalidatePath("/jobs");
    return { success: true };
  } catch (error) {
    return fromDomainError(error, "Something went wrong submitting this review.");
  }
}

/**
 * Module 41 — Reviews & Ratings: thin Server Action adapter for
 * UpdateReviewUseCase — ownership and the edit-window rule are enforced
 * entirely inside the use case, never here. `reviewId` is re-verified
 * server-side against the caller's session; it is never trusted as proof
 * of ownership just because it was passed in (same convention as
 * `createReviewAction`'s own doc comment).
 */
export async function updateReviewAction(
  reviewId: string,
  rating: number,
  comment: string,
  jobId: string,
): Promise<ActionResult> {
  const user = await requireAuth();
  const parsed = updateReviewSchema.safeParse({ reviewId, rating, comment });
  if (!parsed.success) {
    return { success: false, error: parsed.error.issues[0]?.message ?? "Invalid review." };
  }

  try {
    await makeUpdateReviewUseCase().execute(user.id, parsed.data.reviewId, {
      rating: parsed.data.rating,
      comment: parsed.data.comment ? parsed.data.comment : null,
    });
    revalidatePath(`/jobs/${jobId}`);
    revalidatePath("/jobs");
    return { success: true };
  } catch (error) {
    return fromDomainError(error, "Something went wrong updating this review.");
  }
}

/**
 * Module 41 — Reviews & Ratings: thin Server Action adapter for
 * DeleteReviewUseCase (soft delete — see that class's own doc comment).
 */
export async function deleteReviewAction(reviewId: string, jobId: string): Promise<ActionResult> {
  const user = await requireAuth();
  const parsed = deleteReviewSchema.safeParse({ reviewId });
  if (!parsed.success) {
    return { success: false, error: parsed.error.issues[0]?.message ?? "Invalid review." };
  }

  try {
    await makeDeleteReviewUseCase().execute(user.id, parsed.data.reviewId);
    revalidatePath(`/jobs/${jobId}`);
    revalidatePath("/jobs");
    return { success: true };
  } catch (error) {
    return fromDomainError(error, "Something went wrong deleting this review.");
  }
}

/**
 * Module 41 — Reviews & Ratings: thin Server Action adapter for
 * RespondToReviewUseCase — authorization (only the reviewed professional
 * may respond) is entirely inside the use case, never here. Calling this
 * twice for the same review is how a response is edited (see that use
 * case's own doc comment).
 */
export async function respondToReviewAction(reviewId: string, response: string, jobId: string): Promise<ActionResult> {
  const user = await requireAuth();
  const parsed = respondToReviewSchema.safeParse({ reviewId, response });
  if (!parsed.success) {
    return { success: false, error: parsed.error.issues[0]?.message ?? "Invalid response." };
  }

  try {
    await makeRespondToReviewUseCase().execute(user.id, parsed.data.reviewId, parsed.data.response);
    revalidatePath(`/jobs/${jobId}`);
    revalidatePath("/jobs");
    return { success: true };
  } catch (error) {
    return fromDomainError(error, "Something went wrong submitting this response.");
  }
}
