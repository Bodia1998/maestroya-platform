"use server";

import { revalidatePath } from "next/cache";
import { getTranslations } from "next-intl/server";
import type { ZodError } from "zod";

import { DomainError, RateLimitedError } from "@/domain/errors/domain-error";
import { requireAuth } from "@/infrastructure/auth/rbac";
import {
  ALLOWED_REQUEST_PHOTO_MIME_TYPES,
  MAX_REQUEST_PHOTO_BYTES,
  createServiceRequestSchema,
  updateServiceRequestSchema,
} from "@/application/dto/service-request.dto";
import {
  makeAddServiceRequestPhotoUseCase,
  makeCancelServiceRequestUseCase,
  makeCreateServiceRequestUseCase,
  makeRemoveServiceRequestPhotoUseCase,
  makeUpdateServiceRequestUseCase,
} from "@/application/use-cases/service-request/compose";
import { makeAntiAbuseService } from "@/application/use-cases/security/compose";
import { localizeActionError, localizeZodFieldErrors } from "@/presentation/i18n/server";

export type ActionResult =
  | { success: true }
  | { success: false; error: string; fieldErrors?: Record<string, string[]> };

export type CreateActionResult =
  | { success: true; id: string }
  | { success: false; error: string; fieldErrors?: Record<string, string[]> };

// Module 120 — Multilingual Localization: domain errors surface their
// localized message (`localizeActionError`), anything else is logged
// server-side and replaced with the caller's localized fallback.
async function fromDomainError(error: unknown, fallback: string): Promise<ActionResult> {
  return { success: false, error: await localizeActionError(error, fallback) };
}

async function invalidInput(error: ZodError) {
  const tValidation = await getTranslations("validation");
  return {
    success: false as const,
    error: tValidation("summary"),
    fieldErrors: await localizeZodFieldErrors(error),
  };
}

/**
 * Marketplace abuse (Module 24, threat C) — spam/duplicate service-request
 * creation. Rate-limited per authenticated user (see rate-limit-
 * policies.ts's SERVICE_REQUEST_CREATE_BY_USER) and blocked outright for
 * an account under an active TEMPORARILY_BLOCKED restriction, both checked
 * before the use case runs.
 */
export async function createServiceRequestAction(formData: unknown): Promise<CreateActionResult> {
  const user = await requireAuth();

  const parsed = createServiceRequestSchema.safeParse(formData);
  if (!parsed.success) {
    return invalidInput(parsed.error);
  }

  const antiAbuse = makeAntiAbuseService();
  try {
    await antiAbuse.assertNotBlocked(user.id);
    await antiAbuse.enforceRateLimit(
      "SERVICE_REQUEST_CREATE_BY_USER",
      { userId: user.id },
      "SERVICE_REQUEST_RATE_LIMITED",
    );
  } catch (error) {
    if (error instanceof DomainError) {
      return { success: false, error: await localizeActionError(error) };
    }
    throw error;
  }

  try {
    const created = await makeCreateServiceRequestUseCase().execute(user.id, parsed.data);
    revalidatePath("/requests");
    return { success: true, id: created.id };
  } catch (error) {
    const t = await getTranslations("customer");
    return (await fromDomainError(error, t("requests.errors.createFailed"))) as CreateActionResult;
  }
}

export async function updateServiceRequestAction(
  requestId: string,
  formData: unknown,
): Promise<ActionResult> {
  const user = await requireAuth();

  const parsed = updateServiceRequestSchema.safeParse(formData);
  if (!parsed.success) {
    return invalidInput(parsed.error);
  }

  try {
    await makeUpdateServiceRequestUseCase().execute(user.id, requestId, parsed.data);
    revalidatePath("/requests");
    revalidatePath(`/requests/${requestId}`);
    return { success: true };
  } catch (error) {
    const t = await getTranslations("customer");
    return fromDomainError(error, t("requests.errors.updateFailed"));
  }
}

export async function cancelServiceRequestAction(requestId: string): Promise<ActionResult> {
  const user = await requireAuth();

  try {
    await makeCancelServiceRequestUseCase().execute(user.id, requestId);
    revalidatePath("/requests");
    revalidatePath(`/requests/${requestId}`);
    return { success: true };
  } catch (error) {
    const t = await getTranslations("customer");
    return fromDomainError(error, t("requests.errors.cancelFailed"));
  }
}

export async function addServiceRequestPhotoAction(
  requestId: string,
  formData: FormData,
): Promise<ActionResult> {
  const user = await requireAuth();

  const t = await getTranslations("customer");
  const file = formData.get("photo");
  if (!(file instanceof File) || file.size === 0) {
    return { success: false, error: t("requests.errors.photoMissing") };
  }
  // Server-side checks — the client's <input accept> and the browser-
  // reported File.type are both just hints, not guarantees; these are the
  // checks that actually matter. Same rationale as the avatar upload
  // action; CloudinaryRequestPhotoUploadService re-checks independently.
  if (!ALLOWED_REQUEST_PHOTO_MIME_TYPES.includes(file.type as (typeof ALLOWED_REQUEST_PHOTO_MIME_TYPES)[number])) {
    return { success: false, error: t("requests.errors.photoType") };
  }
  if (file.size > MAX_REQUEST_PHOTO_BYTES) {
    return { success: false, error: t("requests.errors.photoTooLarge") };
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

  const caption = formData.get("caption");

  try {
    const buffer = Buffer.from(await file.arrayBuffer());
    await makeAddServiceRequestPhotoUseCase().execute(
      user.id,
      requestId,
      buffer,
      file.type,
      typeof caption === "string" && caption.length > 0 ? caption : null,
    );
    revalidatePath(`/requests/${requestId}`);
    revalidatePath(`/requests/${requestId}/edit`);
    return { success: true };
  } catch (error) {
    return fromDomainError(error, t("requests.errors.photoUploadFailed"));
  }
}

export async function removeServiceRequestPhotoAction(
  requestId: string,
  photoId: string,
): Promise<ActionResult> {
  const user = await requireAuth();

  try {
    await makeRemoveServiceRequestPhotoUseCase().execute(user.id, requestId, photoId);
    revalidatePath(`/requests/${requestId}`);
    revalidatePath(`/requests/${requestId}/edit`);
    return { success: true };
  } catch (error) {
    const t = await getTranslations("customer");
    return fromDomainError(error, t("requests.errors.photoRemoveFailed"));
  }
}
