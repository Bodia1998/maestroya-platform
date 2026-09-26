"use server";

import { adminActionFailure } from "../_lib/action-errors";
import { localizeZodError } from "@/presentation/i18n/server";
import { revalidatePath } from "next/cache";

import {
  adminCompanyVerificationIdSchema,
  rejectCompanyVerificationSchema,
  requestCompanyVerificationResubmissionSchema,
} from "@/application/dto/company-verification.dto";
import {
  makeApproveCompanyVerificationUseCase,
  makeRejectCompanyVerificationUseCase,
  makeRequestCompanyVerificationResubmissionUseCase,
  makeStartCompanyVerificationReviewUseCase,
} from "@/application/use-cases/company-verification/compose";
import { ROLES, requireRole } from "@/infrastructure/auth/rbac";

/** Module 18 — Company Professional: admin company-verification review
 *  actions — mirrors admin/verifications/actions.ts (Module 17) exactly. */

export type ActionResult = { success: true } | { success: false; error: string };

function revalidate(verificationId: string) {
  revalidatePath("/admin/company-verifications");
  revalidatePath(`/admin/company-verifications/${verificationId}`);
}

export async function startCompanyVerificationReviewAction(verificationId: string): Promise<ActionResult> {
  const admin = await requireRole(ROLES.ADMIN, ROLES.SUPER_ADMIN);
  const parsed = adminCompanyVerificationIdSchema.safeParse({ verificationId });
  if (!parsed.success) return { success: false, error: await localizeZodError(parsed.error) };
  try {
    await makeStartCompanyVerificationReviewUseCase().execute(admin.id, parsed.data.verificationId);
    revalidate(parsed.data.verificationId);
    return { success: true };
  } catch (error) {
    return adminActionFailure(error, "startingTheReview");
  }
}

export async function approveCompanyVerificationAction(verificationId: string): Promise<ActionResult> {
  const admin = await requireRole(ROLES.ADMIN, ROLES.SUPER_ADMIN);
  const parsed = adminCompanyVerificationIdSchema.safeParse({ verificationId });
  if (!parsed.success) return { success: false, error: await localizeZodError(parsed.error) };
  try {
    await makeApproveCompanyVerificationUseCase().execute(admin.id, parsed.data.verificationId);
    revalidate(parsed.data.verificationId);
    return { success: true };
  } catch (error) {
    return adminActionFailure(error, "approvingThisVerification");
  }
}

export async function rejectCompanyVerificationAction(verificationId: string, reason: string): Promise<ActionResult> {
  const admin = await requireRole(ROLES.ADMIN, ROLES.SUPER_ADMIN);
  const parsed = rejectCompanyVerificationSchema.safeParse({ verificationId, reason });
  if (!parsed.success) return { success: false, error: await localizeZodError(parsed.error) };
  try {
    await makeRejectCompanyVerificationUseCase().execute(admin.id, parsed.data.verificationId, parsed.data.reason);
    revalidate(parsed.data.verificationId);
    return { success: true };
  } catch (error) {
    return adminActionFailure(error, "rejectingThisVerification");
  }
}

export async function requestCompanyVerificationResubmissionAction(
  verificationId: string,
  reason: string,
): Promise<ActionResult> {
  const admin = await requireRole(ROLES.ADMIN, ROLES.SUPER_ADMIN);
  const parsed = requestCompanyVerificationResubmissionSchema.safeParse({ verificationId, reason });
  if (!parsed.success)
    return { success: false, error: await localizeZodError(parsed.error) };
  try {
    await makeRequestCompanyVerificationResubmissionUseCase().execute(
      admin.id,
      parsed.data.verificationId,
      parsed.data.reason,
    );
    revalidate(parsed.data.verificationId);
    return { success: true };
  } catch (error) {
    return adminActionFailure(error, "requestingAResubmission");
  }
}

// --- Form-bindable wrappers ---

export async function startCompanyVerificationReviewFormAction(verificationId: string): Promise<void> {
  await startCompanyVerificationReviewAction(verificationId);
}

export async function approveCompanyVerificationFormAction(verificationId: string): Promise<void> {
  await approveCompanyVerificationAction(verificationId);
}

export async function rejectCompanyVerificationFormAction(verificationId: string, formData: FormData): Promise<void> {
  await rejectCompanyVerificationAction(verificationId, String(formData.get("reason") ?? ""));
}

export async function requestCompanyVerificationResubmissionFormAction(
  verificationId: string,
  formData: FormData,
): Promise<void> {
  await requestCompanyVerificationResubmissionAction(verificationId, String(formData.get("reason") ?? ""));
}
