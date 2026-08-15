"use server";

import { revalidatePath } from "next/cache";

import { adminResolvePaymentReleaseSchema } from "@/application/dto/job.dto";
import { makeAdminResolvePaymentReleaseUseCase } from "@/application/use-cases/job/compose";
import { DomainError } from "@/domain/errors/domain-error";
import { ROLES, requireRole } from "@/infrastructure/auth/rbac";

/**
 * Module 66 — Job Completion & Payment Release Protection: admin Server
 * Action adapter for `AdminResolvePaymentReleaseUseCase` — same
 * "requireRole first, business logic in the use case" convention as
 * admin/disputes/actions.ts. Requires ADMIN/SUPER_ADMIN/SUPPORT, same set
 * as every other admin dispute/review action in this codebase.
 *
 * Only applicable to a job whose completion confirmation is DISPUTED or
 * under manual review after a timeout — see that use case's own doc
 * comment for the full precondition (the linked Dispute must already be
 * CLOSED, or the linked ManualReviewCase already RESOLVED/REJECTED,
 * before `decision: "APPROVE"` is accepted).
 */
export type ActionResult<T = undefined> = { success: true; data: T } | { success: false; error: string };

function fromDomainError<T>(error: unknown, fallback: string): ActionResult<T> {
  if (error instanceof DomainError) {
    return { success: false, error: error.message };
  }
  console.error(error);
  return { success: false, error: fallback };
}

export async function adminResolvePaymentReleaseAction(input: {
  jobId: string;
  decision: string;
  note?: string;
}): Promise<ActionResult> {
  const admin = await requireRole(ROLES.ADMIN, ROLES.SUPER_ADMIN, ROLES.SUPPORT);
  const parsed = adminResolvePaymentReleaseSchema.safeParse(input);
  if (!parsed.success) {
    return { success: false, error: parsed.error.issues[0]?.message ?? "Invalid request." };
  }

  try {
    await makeAdminResolvePaymentReleaseUseCase().execute(
      admin.id,
      parsed.data.jobId,
      parsed.data.decision,
      parsed.data.note ? parsed.data.note : "",
    );
    revalidatePath(`/jobs/${input.jobId}`);
    revalidatePath("/admin/disputes");
    return { success: true, data: undefined };
  } catch (error) {
    return fromDomainError(error, "Something went wrong resolving this job's payment release.");
  }
}
