"use server";

import { revalidatePath } from "next/cache";

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
import { DomainError } from "@/domain/errors/domain-error";
import { requireAuth } from "@/infrastructure/auth/rbac";

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

function fromDomainError(error: unknown, fallback: string): ActionResult {
  if (error instanceof DomainError) {
    return { success: false, error: error.message };
  }
  console.error(error);
  return { success: false, error: fallback };
}

const PATH = "/dashboard/professional/verification";

export async function requestVerificationAction(): Promise<ActionResult> {
  const user = await requireAuth();
  try {
    await makeCreateProfessionalVerificationUseCase().execute(user.id);
    revalidatePath(PATH);
    return { success: true };
  } catch (error) {
    return fromDomainError(error, "Something went wrong starting your verification request.");
  }
}

export async function uploadVerificationDocumentAction(formData: FormData): Promise<ActionResult> {
  const user = await requireAuth();

  const parsed = uploadVerificationDocumentSchema.safeParse({ type: formData.get("type") });
  if (!parsed.success) {
    return { success: false, error: parsed.error.issues[0]?.message ?? "Choose a valid document type." };
  }

  const file = formData.get("file");
  if (!(file instanceof File) || file.size === 0) {
    return { success: false, error: "Choose a file to upload." };
  }
  // Server-side checks — the client's <input accept> and browser-reported
  // File.type are only hints; these are the checks that matter. The
  // Cloudinary service re-checks independently too.
  if (!ALLOWED_VERIFICATION_DOCUMENT_MIME_TYPES.includes(file.type as (typeof ALLOWED_VERIFICATION_DOCUMENT_MIME_TYPES)[number])) {
    return { success: false, error: "Documents must be a JPEG, PNG, WebP image or a PDF." };
  }
  if (file.size > MAX_VERIFICATION_DOCUMENT_BYTES) {
    return { success: false, error: "Each document must be smaller than 10MB." };
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
    return fromDomainError(error, "Something went wrong uploading your document.");
  }
}

export async function removeVerificationDocumentAction(documentId: string): Promise<ActionResult> {
  const user = await requireAuth();

  const parsed = verificationDocumentIdSchema.safeParse({ documentId });
  if (!parsed.success) {
    return { success: false, error: parsed.error.issues[0]?.message ?? "Invalid document." };
  }

  try {
    await makeRemoveVerificationDocumentUseCase().execute(user.id, parsed.data.documentId);
    revalidatePath(PATH);
    return { success: true };
  } catch (error) {
    return fromDomainError(error, "Something went wrong removing your document.");
  }
}

export async function submitVerificationAction(): Promise<ActionResult> {
  const user = await requireAuth();
  try {
    await makeSubmitProfessionalVerificationUseCase().execute(user.id);
    revalidatePath(PATH);
    return { success: true };
  } catch (error) {
    return fromDomainError(error, "Something went wrong submitting your verification request.");
  }
}

export async function resubmitVerificationAction(): Promise<ActionResult> {
  const user = await requireAuth();
  try {
    await makeResubmitProfessionalVerificationUseCase().execute(user.id);
    revalidatePath(PATH);
    return { success: true };
  } catch (error) {
    return fromDomainError(error, "Something went wrong resubmitting your verification request.");
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
