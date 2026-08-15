"use server";

import { revalidatePath } from "next/cache";

import {
  cancelJobSchema,
  completeJobSchema,
  confirmJobCompletionSchema,
  disputeJobCompletionSchema,
  startJobSchema,
} from "@/application/dto/job.dto";
import {
  makeCancelJobUseCase,
  makeCompleteJobUseCase,
  makeConfirmJobCompletionUseCase,
  makeDisputeJobCompletionUseCase,
  makeStartJobUseCase,
} from "@/application/use-cases/job/compose";
import { DomainError } from "@/domain/errors/domain-error";
import { requireAuth } from "@/infrastructure/auth/rbac";

export type ActionResult = { success: true } | { success: false; error: string };

// Same translation convention as every other module's actions.ts (see
// appointments/actions.ts): domain errors surface their own safe,
// user-facing message; anything else is logged server-side and replaced
// with a generic one.
function fromDomainError(error: unknown, fallback: string): ActionResult {
  if (error instanceof DomainError) {
    return { success: false, error: error.message };
  }
  console.error(error);
  return { success: false, error: fallback };
}

// Both the customer- and professional-side job pages import these same
// actions — authorization (which side the caller is on, whether they're a
// participant in this specific Job at all, and whether that side is even
// allowed to perform this action) is resolved entirely inside the use
// cases via resolveJobActor, never here. `jobId` is always re-verified
// server-side against the caller's session; it is never trusted as proof
// of ownership just because it was passed in.

function revalidateJobPaths(jobId: string) {
  revalidatePath(`/jobs/${jobId}`);
  revalidatePath("/jobs");
  revalidatePath("/dashboard/professional/jobs");
  revalidatePath(`/dashboard/professional/jobs/${jobId}`);
}

export async function startJobAction(jobId: string): Promise<ActionResult> {
  const user = await requireAuth();
  const parsed = startJobSchema.safeParse({ jobId });
  if (!parsed.success) {
    return { success: false, error: "Invalid job." };
  }

  try {
    await makeStartJobUseCase().execute(user.id, parsed.data.jobId);
    revalidateJobPaths(jobId);
    return { success: true };
  } catch (error) {
    return fromDomainError(error, "Something went wrong starting this job.");
  }
}

export async function completeJobAction(jobId: string): Promise<ActionResult> {
  const user = await requireAuth();
  const parsed = completeJobSchema.safeParse({ jobId });
  if (!parsed.success) {
    return { success: false, error: "Invalid job." };
  }

  try {
    await makeCompleteJobUseCase().execute(user.id, parsed.data.jobId);
    revalidateJobPaths(jobId);
    return { success: true };
  } catch (error) {
    return fromDomainError(error, "Something went wrong completing this job.");
  }
}

export async function cancelJobAction(jobId: string, reason: string, note: string): Promise<ActionResult> {
  const user = await requireAuth();
  const parsed = cancelJobSchema.safeParse({ jobId, reason, note });
  if (!parsed.success) {
    return { success: false, error: parsed.error.issues[0]?.message ?? "Invalid cancellation." };
  }

  try {
    await makeCancelJobUseCase().execute(
      user.id,
      parsed.data.jobId,
      parsed.data.reason,
      parsed.data.note ? parsed.data.note : null,
    );
    revalidateJobPaths(jobId);
    return { success: true };
  } catch (error) {
    return fromDomainError(error, "Something went wrong cancelling this job.");
  }
}

// --- Module 66 — Job Completion & Payment Release Protection ---
// Customer-only actions (enforced inside the use cases via
// resolveJobActor — see ConfirmJobCompletionUseCase/
// DisputeJobCompletionUseCase's own doc comments). Marking a job
// completed (above) never releases payment by itself; these are the two
// ways the customer moves the payment-release gate forward.

export async function confirmJobCompletionAction(jobId: string): Promise<ActionResult> {
  const user = await requireAuth();
  const parsed = confirmJobCompletionSchema.safeParse({ jobId });
  if (!parsed.success) {
    return { success: false, error: "Invalid job." };
  }

  try {
    await makeConfirmJobCompletionUseCase().execute(user.id, parsed.data.jobId);
    revalidateJobPaths(jobId);
    return { success: true };
  } catch (error) {
    return fromDomainError(error, "Something went wrong confirming this job.");
  }
}

export async function disputeJobCompletionAction(input: {
  jobId: string;
  reason: string;
  title: string;
  description: string;
}): Promise<ActionResult> {
  const user = await requireAuth();
  const parsed = disputeJobCompletionSchema.safeParse(input);
  if (!parsed.success) {
    return { success: false, error: parsed.error.issues[0]?.message ?? "Invalid dispute." };
  }

  try {
    await makeDisputeJobCompletionUseCase().execute(user.id, parsed.data.jobId, {
      reason: parsed.data.reason,
      title: parsed.data.title,
      description: parsed.data.description,
    });
    revalidateJobPaths(input.jobId);
    revalidatePath("/disputes");
    return { success: true };
  } catch (error) {
    return fromDomainError(error, "Something went wrong disputing this job's completion.");
  }
}
