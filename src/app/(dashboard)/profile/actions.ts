"use server";

import { revalidatePath } from "next/cache";

import { DomainError } from "@/domain/errors/domain-error";
import { requireAuth } from "@/infrastructure/auth/rbac";
import {
  ALLOWED_AVATAR_MIME_TYPES,
  MAX_AVATAR_BYTES,
  changePasswordSchema,
  deleteAccountSchema,
  updateProfileSchema,
} from "@/application/dto/profile.dto";
import {
  makeChangePasswordUseCase,
  makeDeleteAccountUseCase,
  makeUpdateProfileUseCase,
  makeUploadAvatarUseCase,
} from "@/application/use-cases/profile/compose";

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

export async function updateProfileAction(formData: unknown): Promise<ActionResult> {
  const user = await requireAuth();

  const parsed = updateProfileSchema.safeParse(formData);
  if (!parsed.success) {
    return {
      success: false,
      error: "Please fix the errors below.",
      fieldErrors: parsed.error.flatten().fieldErrors,
    };
  }

  try {
    await makeUpdateProfileUseCase().execute(user.id, parsed.data);
    revalidatePath("/profile");
    return { success: true };
  } catch (error) {
    return fromDomainError(error, "Something went wrong updating your profile.");
  }
}

export async function uploadAvatarAction(formData: FormData): Promise<ActionResult> {
  const user = await requireAuth();

  const file = formData.get("avatar");
  if (!(file instanceof File) || file.size === 0) {
    return { success: false, error: "Choose an image to upload." };
  }
  // Server-side checks — the client's <input accept> and the browser-
  // reported File.type are both just hints an attacker fully controls
  // via a raw request; these are the checks that actually matter. Note
  // this still trusts the browser-reported content type string rather
  // than sniffing the file's actual magic bytes — the project has no
  // file-signature-sniffing library, and adding one for this alone would
  // be disproportionate. CloudinaryAvatarUploadService re-checks the same
  // allowlist independently as defense-in-depth.
  if (!ALLOWED_AVATAR_MIME_TYPES.includes(file.type as (typeof ALLOWED_AVATAR_MIME_TYPES)[number])) {
    return { success: false, error: "Avatar must be a JPEG, PNG, or WebP image." };
  }
  if (file.size > MAX_AVATAR_BYTES) {
    return { success: false, error: "Avatar must be smaller than 5MB." };
  }

  try {
    const buffer = Buffer.from(await file.arrayBuffer());
    await makeUploadAvatarUseCase().execute(user.id, buffer, file.type);
    revalidatePath("/profile");
    return { success: true };
  } catch (error) {
    return fromDomainError(error, "Something went wrong uploading your avatar.");
  }
}

export async function changePasswordAction(formData: unknown): Promise<ActionResult> {
  const user = await requireAuth();

  const parsed = changePasswordSchema.safeParse(formData);
  if (!parsed.success) {
    return {
      success: false,
      error: "Please fix the errors below.",
      fieldErrors: parsed.error.flatten().fieldErrors,
    };
  }

  try {
    await makeChangePasswordUseCase().execute(
      user.id,
      parsed.data.currentPassword,
      parsed.data.newPassword,
    );
    return { success: true };
  } catch (error) {
    return fromDomainError(error, "Something went wrong changing your password.");
  }
}

export async function deleteAccountAction(formData: unknown): Promise<ActionResult> {
  const user = await requireAuth();

  const parsed = deleteAccountSchema.safeParse(formData);
  if (!parsed.success) {
    return {
      success: false,
      error: "Please fix the errors below.",
      fieldErrors: parsed.error.flatten().fieldErrors,
    };
  }

  try {
    await makeDeleteAccountUseCase().execute(user.id, parsed.data.password);
    return { success: true };
  } catch (error) {
    return fromDomainError(error, "Something went wrong deleting your account.");
  }
}
