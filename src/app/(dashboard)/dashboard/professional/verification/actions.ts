"use server";

import { revalidatePath } from "next/cache";
import { getTranslations } from "next-intl/server";

import {
  ALLOWED_VERIFICATION_DOCUMENT_MIME_TYPES,
  MAX_VERIFICATION_DOCUMENT_BYTES,
  uploadVerificationDocumentSchema,
  verificationDocumentIdSchema,
} from "@/application/dto/verification.dto";
import {
  makeCreateProfessionalVerificationUseCase,
  makeRemoveVerificationDocumentUseCase,
  makeResubmitProfessionalVerificationUseCase,
  makeSubmitProfessionalVerificationUseCase,
  makeUploadVerificationDocumentUseCase,
} from "@/application/use-cases/verification/compose";
import { RateLimitedError } from "@/domain/errors/domain-error";
import { requireAuth } from "@/infrastructure/auth/rbac";
import { localizeActionError, localizeZodError } from "@/presentation/i18n/server";
import { makeAntiAbuseService } from "@/application/use-cases/security/compose";

/**
 * Professional Verification module (Module 17): thin Server Action adapters
 * for the professional's own verification page — same pattern as every other
 * module's actions.ts. All business logic (ownership resolved from the
 * session, state-machine checks, required-document rules) lives in the
 * composed use cases; `professionalProfileId`/`verificationId` are never
 * accepted from the client for the owner's own case — they are re-derived
 * server-side inside each use case from `user.id`.
 */

export type ActionResult =
  | { success: true }
  | { success: false; error: string; fieldErrors?: Record<string, string[]> };

// Module 120 — errors are localised at the edge (`localizeActionError`):
// domain errors map to their catalog sentence, anything else is logged
// server-side and replaced with the localised fallback.
type FallbackKey =
  | "startVerification"
  | "uploadDocument"
  | "removeDocument"
  | "submitVerification"
  | "resubmitVerification";

async function fromDomainError(error: unknown, fallbackKey: FallbackKey): Promise<ActionResult> {
  const t = await getTranslations("professional.errors");
  return { success: false, error: await localizeActionError(error, t(fallbackKey)) };
}

const PATH = "/dashboard/professional/verification";

export async function requestVerificationAction(): Promise<ActionResult> {
  const user = await requireAuth();
  try {
    await makeCreateProfessionalVerificationUseCase().execute(user.id);
    revalidatePath(PATH);
    return { success: true };
  } catch (error) {
    return fromDomainError(error, "startVerification");
  }
}

export async function uploadVerificationDocumentAction(formData: FormData): Promise<ActionResult> {
  const user = await requireAuth();

  const parsed = uploadVerificationDocumentSchema.safeParse({ type: formData.get("type") });
  if (!parsed.success) {
    const t = await getTranslations("professional.errors");
    return { success: false, error: await localizeZodError(parsed.error, t("invalidDocumentType")) };
  }

  const file = formData.get("file");
  if (!(file instanceof File) || file.size === 0) {
    const t = await getTranslations("professional.errors");
    return { success: false, error: t("fileRequired") };
  }
  // Server-side checks — the client's <input accept> and browser-reported
  // File.type are only hints; these are the checks that matter. The
  // Cloudinary service re-checks independently too.
  if (!ALLOWED_VERIFICATION_DOCUMENT_MIME_TYPES.includes(file.type as (typeof ALLOWED_VERIFICATION_DOCUMENT_MIME_TYPES)[number])) {
    const t = await getTranslations("professional.errors");
    return { success: false, error: t("invalidFileType") };
  }
  if (file.size > MAX_VERIFICATION_DOCUMENT_BYTES) {
    const t = await getTranslations("professional.errors");
    return { success: false, error: t("fileTooLarge", { maxMb: MAX_VERIFICATION_DOCUMENT_BYTES / (1024 * 1024) }) };
  }

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
      return { success: false, error: await localizeActionError(error) };
    }
    throw error;
  }

  try {
    const buffer = Buffer.from(await file.arrayBuffer());
    await makeUploadVerificationDocumentUseCase().execute(user.id, {
      type: parsed.data.type,
      fileBuffer: buffer,
      contentType: file.type,
      originalFilename: file.name,
      fileSizeBytes: file.size,
    });
    revalidatePath(PATH);
    return { success: true };
  } catch (error) {
    return fromDomainError(error, "uploadDocument");
  }
}

export async function removeVerificationDocumentAction(documentId: string): Promise<ActionResult> {
  const user = await requireAuth();

  const parsed = verificationDocumentIdSchema.safeParse({ documentId });
  if (!parsed.success) {
    const t = await getTranslations("professional.errors");
    return { success: false, error: await localizeZodError(parsed.error, t("invalidDocument")) };
  }

  try {
    await makeRemoveVerificationDocumentUseCase().execute(user.id, parsed.data.documentId);
    revalidatePath(PATH);
    return { success: true };
  } catch (error) {
    return fromDomainError(error, "removeDocument");
  }
}

export async function submitVerificationAction(): Promise<ActionResult> {
  const user = await requireAuth();
  try {
    await makeSubmitProfessionalVerificationUseCase().execute(user.id);
    revalidatePath(PATH);
    return { success: true };
  } catch (error) {
    return fromDomainError(error, "submitVerification");
  }
}

export async function resubmitVerificationAction(): Promise<ActionResult> {
  const user = await requireAuth();
  try {
    await makeResubmitProfessionalVerificationUseCase().execute(user.id);
    revalidatePath(PATH);
    return { success: true };
  } catch (error) {
    return fromDomainError(error, "resubmitVerification");
  }
}

// ---------------------------------------------------------------------------
// Form-bindable wrappers
// ---------------------------------------------------------------------------
//
// A plain HTML <form action={...}> requires a Server Action shaped
// `(formData: FormData) => void | Promise<void>`. Every action above returns
// `ActionResult` (so a richer client could inspect success/error), so these
// thin wrappers exist purely to satisfy the `<form>` element's type contract
// for the minimal server-rendered verification UI. Each still goes through
// the exact same requireAuth() + validation + use case — no second, less-safe
// code path. Same convention as admin/actions.ts's own wrappers.

export async function requestVerificationFormAction(): Promise<void> {
  await requestVerificationAction();
}

export async function uploadVerificationDocumentFormAction(formData: FormData): Promise<void> {
  await uploadVerificationDocumentAction(formData);
}

export async function removeVerificationDocumentFormAction(documentId: string): Promise<void> {
  await removeVerificationDocumentAction(documentId);
}

export async function submitVerificationFormAction(): Promise<void> {
  await submitVerificationAction();
}

export async function resubmitVerificationFormAction(): Promise<void> {
  await resubmitVerificationAction();
}
