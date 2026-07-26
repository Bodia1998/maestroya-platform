"use server";

import { revalidatePath } from "next/cache";

import { DomainError } from "@/domain/errors/domain-error";
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

export type ActionResult =
  | { success: true }
  | { success: false; error: string; fieldErrors?: Record<string, string[]> };

export type CreateActionResult =
  | { success: true; id: string }
  | { success: false; error: string; fieldErrors?: Record<string, string[]> };

// Same translation convention as Profile/Professional's actions.ts: domain
// errors surface their own (safe, user-facing) message, anything else is
// logged server-side and replaced with a generic message.
function fromDomainError(error: unknown, fallback: string): ActionResult {
  if (error instanceof DomainError) {
    return { success: false, error: error.message };
  }
  console.error(error);
  return { success: false, error: fallback };
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
    return {
      success: false,
      error: "Please fix the errors below.",
      fieldErrors: parsed.error.flatten().fieldErrors,
    };
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
      return { success: false, error: error.message } as CreateActionResult;
    }
    throw error;
  }

  try {
    const created = await makeCreateServiceRequestUseCase().execute(user.id, parsed.data);
    revalidatePath("/requests");
    return { success: true, id: created.id };
  } catch (error) {
    const result = fromDomainError(error, "Something went wrong creating your service request.");
    return result as CreateActionResult;
  }
}

export async function updateServiceRequestAction(
  requestId: string,
  formData: unknown,
): Promise<ActionResult> {
  const user = await requireAuth();

  const parsed = updateServiceRequestSchema.safeParse(formData);
  if (!parsed.success) {
    return {
      success: false,
      error: "Please fix the errors below.",
      fieldErrors: parsed.error.flatten().fieldErrors,
    };
  }

  try {
    await makeUpdateServiceRequestUseCase().execute(user.id, requestId, parsed.data);
    revalidatePath("/requests");
    revalidatePath(`/requests/${requestId}`);
    return { success: true };
  } catch (error) {
    return fromDomainError(error, "Something went wrong updating your service request.");
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
    return fromDomainError(error, "Something went wrong cancelling your service request.");
  }
}

export async function addServiceRequestPhotoAction(
  requestId: string,
  formData: FormData,
): Promise<ActionResult> {
  const user = await requireAuth();

  const file = formData.get("photo");
  if (!(file instanceof File) || file.size === 0) {
    return { success: false, error: "Choose an image to upload." };
  }
  // Server-side checks — the client's <input accept> and the browser-
  // reported File.type are both just hints, not guarantees; these are the
  // checks that actually matter. Same rationale as the avatar upload
  // action; CloudinaryRequestPhotoUploadService re-checks independently.
  if (!ALLOWED_REQUEST_PHOTO_MIME_TYPES.includes(file.type as (typeof ALLOWED_REQUEST_PHOTO_MIME_TYPES)[number])) {
    return { success: false, error: "Photos must be a JPEG, PNG, or WebP image." };
  }
  if (file.size > MAX_REQUEST_PHOTO_BYTES) {
    return { success: false, error: "Each photo must be smaller than 5MB." };
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
    return fromDomainError(error, "Something went wrong uploading your photo.");
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
    return fromDomainError(error, "Something went wrong removing that photo.");
  }
}
