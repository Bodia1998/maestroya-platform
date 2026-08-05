"use server";

import { revalidatePath } from "next/cache";

import {
  ALLOWED_COMPANY_VERIFICATION_DOCUMENT_MIME_TYPES,
  MAX_COMPANY_VERIFICATION_DOCUMENT_BYTES,
  companyVerificationDocumentIdSchema,
  uploadCompanyVerificationDocumentSchema,
} from "@/application/dto/company-verification.dto";
import {
  makeCreateCompanyVerificationUseCase,
  makeRemoveCompanyVerificationDocumentUseCase,
  makeResubmitCompanyVerificationUseCase,
  makeSubmitCompanyVerificationUseCase,
  makeUploadCompanyVerificationDocumentUseCase,
} from "@/application/use-cases/company-verification/compose";
import { DomainError, RateLimitedError } from "@/domain/errors/domain-error";
import { requireAuth } from "@/infrastructure/auth/rbac";
import { makeAntiAbuseService } from "@/application/use-cases/security/compose";

/** Module 18 — Company Professional: company verification Server Actions —
 *  mirrors dashboard/professional/verification/actions.ts (Module 17). */

export type ActionResult = { success: true } | { success: false; error: string };

function fromDomainError(error: unknown, fallback: string): ActionResult {
  if (error instanceof DomainError) return { success: false, error: error.message };
  console.error(error);
  return { success: false, error: fallback };
}

function path(companyId: string) {
  return `/dashboard/company/${companyId}/verification`;
}

export async function requestCompanyVerificationAction(companyId: string): Promise<ActionResult> {
  const user = await requireAuth();
  try {
    await makeCreateCompanyVerificationUseCase().execute(user.id, companyId);
    revalidatePath(path(companyId));
    return { success: true };
  } catch (error) {
    return fromDomainError(error, "Something went wrong starting verification.");
  }
}

export async function uploadCompanyVerificationDocumentAction(companyId: string, formData: FormData): Promise<ActionResult> {
  const user = await requireAuth();
  const parsed = uploadCompanyVerificationDocumentSchema.safeParse({ type: formData.get("type") });
  if (!parsed.success) return { success: false, error: parsed.error.issues[0]?.message ?? "Choose a valid document type." };

  const file = formData.get("file");
  if (!(file instanceof File) || file.size === 0) return { success: false, error: "Choose a file to upload." };
  if (!ALLOWED_COMPANY_VERIFICATION_DOCUMENT_MIME_TYPES.includes(file.type as (typeof ALLOWED_COMPANY_VERIFICATION_DOCUMENT_MIME_TYPES)[number])) {
    return { success: false, error: "Documents must be a JPEG, PNG, WebP image or a PDF." };
  }
  if (file.size > MAX_COMPANY_VERIFICATION_DOCUMENT_BYTES) return { success: false, error: "Each document must be smaller than 10MB." };

  // Module 33 — Security Hardening: see FILE_UPLOAD_BY_USER's doc comment
  // (rate-limit-policies.ts) — uploads were previously unrestricted in
  // frequency.
  try {
    await makeAntiAbuseService().enforceRateLimit(
      "FILE_UPLOAD_BY_USER",
      { userId: user.id },
      "RATE_LIMIT_TRIGGERED",
    );
  } catch (error) {
    if (error instanceof RateLimitedError) {
      return { success: false, error: error.message };
    }
    throw error;
  }

  try {
    const buffer = Buffer.from(await file.arrayBuffer());
    await makeUploadCompanyVerificationDocumentUseCase().execute(user.id, companyId, {
      type: parsed.data.type,
      fileBuffer: buffer,
      contentType: file.type,
      originalFilename: file.name,
      fileSizeBytes: file.size,
    });
    revalidatePath(path(companyId));
    return { success: true };
  } catch (error) {
    return fromDomainError(error, "Something went wrong uploading this document.");
  }
}

export async function removeCompanyVerificationDocumentAction(companyId: string, documentId: string): Promise<ActionResult> {
  const user = await requireAuth();
  const parsed = companyVerificationDocumentIdSchema.safeParse({ documentId });
  if (!parsed.success) return { success: false, error: parsed.error.issues[0]?.message ?? "Invalid document." };
  try {
    await makeRemoveCompanyVerificationDocumentUseCase().execute(user.id, companyId, parsed.data.documentId);
    revalidatePath(path(companyId));
    return { success: true };
  } catch (error) {
    return fromDomainError(error, "Something went wrong removing this document.");
  }
}

export async function submitCompanyVerificationAction(companyId: string): Promise<ActionResult> {
  const user = await requireAuth();
  try {
    await makeSubmitCompanyVerificationUseCase().execute(user.id, companyId);
    revalidatePath(path(companyId));
    return { success: true };
  } catch (error) {
    return fromDomainError(error, "Something went wrong submitting for review.");
  }
}

export async function resubmitCompanyVerificationAction(companyId: string): Promise<ActionResult> {
  const user = await requireAuth();
  try {
    await makeResubmitCompanyVerificationUseCase().execute(user.id, companyId);
    revalidatePath(path(companyId));
    return { success: true };
  } catch (error) {
    return fromDomainError(error, "Something went wrong resubmitting for review.");
  }
}

// --- Form-bindable wrappers ---

export async function requestCompanyVerificationFormAction(companyId: string): Promise<void> {
  await requestCompanyVerificationAction(companyId);
}
export async function uploadCompanyVerificationDocumentFormAction(companyId: string, formData: FormData): Promise<void> {
  await uploadCompanyVerificationDocumentAction(companyId, formData);
}
export async function removeCompanyVerificationDocumentFormAction(companyId: string, documentId: string): Promise<void> {
  await removeCompanyVerificationDocumentAction(companyId, documentId);
}
export async function submitCompanyVerificationFormAction(companyId: string): Promise<void> {
  await submitCompanyVerificationAction(companyId);
}
export async function resubmitCompanyVerificationFormAction(companyId: string): Promise<void> {
  await resubmitCompanyVerificationAction(companyId);
}
