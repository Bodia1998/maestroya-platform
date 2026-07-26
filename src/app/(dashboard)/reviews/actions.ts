"use server";

import { revalidatePath } from "next/cache";

import { createReviewSchema } from "@/application/dto/review.dto";
import { makeCreateReviewUseCase } from "@/application/use-cases/review/compose";
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
