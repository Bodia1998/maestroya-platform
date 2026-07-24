"use server";

import { revalidatePath } from "next/cache";

import {
  adminVerificationIdSchema,
  rejectVerificationSchema,
  requestVerificationResubmissionSchema,
} from "@/application/dto/verification.dto";
import {
  makeApproveProfessionalVerificationUseCase,
  makeRejectProfessionalVerificationUseCase,
  makeRequestVerificationResubmissionUseCase,
  makeStartVerificationReviewUseCase,
} from "@/application/use-cases/verification/compose";
import { DomainError } from "@/domain/errors/domain-error";
import { ROLES, requireRole } from "@/infrastructure/auth/rbac";

/**
 * Professional Verification module (Module 17): admin review Server Actions.
 * Same discipline as admin/actions.ts — every action calls
 * `requireRole(ROLES.ADMIN, ROLES.SUPER_ADMIN)` before doing anything else,
 * validates client input with Zod, and calls the use case with the
 * *session-derived* admin id (never a client-supplied one). Reject and
 * request-resubmission require a reason, enforced both here (Zod) and again
 * inside the use case. There is no code path here that reads a role/adminId
 * from client input.
 */

export type ActionResult = { success: true } | { success: false; error: string };

function fromDomainError(error: unknown, fallback: string): ActionResult {
  if (error instanceof DomainError) {
    return { success: false, error: error.message };
  }
  console.error(error);
  return { success: false, error: fallback };
}

function revalidate(verificationId: string) {
  revalidatePath("/admin/verifications");
  revalidatePath(`/admin/verifications/${verificationId}`);
}

export async function startVerificationReviewAction(verificationId: string): Promise<ActionResult> {
  const admin = await requireRole(ROLES.ADMIN, ROLES.SUPER_ADMIN);
  const parsed = adminVerificationIdSchema.safeParse({ verificationId });
  if (!parsed.success) {
    return { success: false, error: parsed.error.issues[0]?.message ?? "Invalid verification." };
  }
  try {
    await makeStartVerificationReviewUseCase().execute(admin.id, parsed.data.verificationId);
    revalidate(parsed.data.verificationId);
    return { success: true };
  } catch (error) {
    return fromDomainError(error, "Something went wrong starting the review.");
  }
}

export async function approveVerificationAction(verificationId: string): Promise<ActionResult> {
  const admin = await requireRole(ROLES.ADMIN, ROLES.SUPER_ADMIN);
  const parsed = adminVerificationIdSchema.safeParse({ verificationId });
  if (!parsed.success) {
    return { success: false, error: parsed.error.issues[0]?.message ?? "Invalid verification." };
  }
  try {
    await makeApproveProfessionalVerificationUseCase().execute(admin.id, parsed.data.verificationId);
    revalidate(parsed.data.verificationId);
    return { success: true };
  } catch (error) {
    return fromDomainError(error, "Something went wrong approving this verification.");
  }
}

export async function rejectVerificationAction(verificationId: string, reason: string): Promise<ActionResult> {
  const admin = await requireRole(ROLES.ADMIN, ROLES.SUPER_ADMIN);
  const parsed = rejectVerificationSchema.safeParse({ verificationId, reason });
  if (!parsed.success) {
    return { success: false, error: parsed.error.issues[0]?.message ?? "A rejection reason is required." };
  }
  try {
    await makeRejectProfessionalVerificationUseCase().execute(admin.id, parsed.data.verificationId, parsed.data.reason);
    revalidate(parsed.data.verificationId);
    return { success: true };
  } catch (error) {
    return fromDomainError(error, "Something went wrong rejecting this verification.");
  }
}

export async function requestVerificationResubmissionAction(
  verificationId: string,
  reason: string,
): Promise<ActionResult> {
  const admin = await requireRole(ROLES.ADMIN, ROLES.SUPER_ADMIN);
  const parsed = requestVerificationResubmissionSchema.safeParse({ verificationId, reason });
  if (!parsed.success) {
    return { success: false, error: parsed.error.issues[0]?.message ?? "A resubmission reason is required." };
  }
  try {
    await makeRequestVerificationResubmissionUseCase().execute(
      admin.id,
      parsed.data.verificationId,
      parsed.data.reason,
    );
    revalidate(parsed.data.verificationId);
    return { success: true };
  } catch (error) {
    return fromDomainError(error, "Something went wrong requesting a resubmission.");
  }
}

// ---------------------------------------------------------------------------
// Form-bindable wrappers (see admin/actions.ts for the rationale). Each still
// goes through the exact same requireRole() + Zod validation + use case.
// ---------------------------------------------------------------------------

export async function startVerificationReviewFormAction(verificationId: string): Promise<void> {
  await startVerificationReviewAction(verificationId);
}

export async function approveVerificationFormAction(verificationId: string): Promise<void> {
  await approveVerificationAction(verificationId);
}

export async function rejectVerificationFormAction(verificationId: string, formData: FormData): Promise<void> {
  await rejectVerificationAction(verificationId, String(formData.get("reason") ?? ""));
}

export async function requestVerificationResubmissionFormAction(
  verificationId: string,
  formData: FormData,
): Promise<void> {
  await requestVerificationResubmissionAction(verificationId, String(formData.get("reason") ?? ""));
}
