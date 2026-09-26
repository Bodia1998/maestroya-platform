"use server";

import { revalidatePath } from "next/cache";
import { getTranslations } from "next-intl/server";
import type { ZodError } from "zod";

import { RateLimitedError } from "@/domain/errors/domain-error";
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
import { makeAntiAbuseService } from "@/application/use-cases/security/compose";
import { localizeActionError, localizeZodFieldErrors } from "@/presentation/i18n/server";

export type ActionResult =
  | { success: true }
  | { success: false; error: string; fieldErrors?: Record<string, string[]> };

// Module 120 — Multilingual Localization: fallbacks are keys in
// `profile.errors`, resolved in the request's locale.
type FallbackKey = "updateFailed" | "avatarFailed" | "passwordFailed" | "deleteFailed";

async function fromDomainError(error: unknown, fallbackKey: FallbackKey): Promise<ActionResult> {
  const t = await getTranslations("profile.errors");
  return { success: false, error: await localizeActionError(error, t(fallbackKey)) };
}

async function invalidInput(error: ZodError): Promise<ActionResult> {
  const tValidation = await getTranslations("validation");
  return { success: false, error: tValidation("summary"), fieldErrors: await localizeZodFieldErrors(error) };
}

export async function updateProfileAction(formData: unknown): Promise<ActionResult> {
  const user = await requireAuth();

  const parsed = updateProfileSchema.safeParse(formData);
  if (!parsed.success) {
    return invalidInput(parsed.error);
  }

  try {
    await makeUpdateProfileUseCase().execute(user.id, parsed.data);
    revalidatePath("/profile");
    return { success: true };
  } catch (error) {
    return fromDomainError(error, "updateFailed");
  }
}

export async function uploadAvatarAction(formData: FormData): Promise<ActionResult> {
  const user = await requireAuth();

  const file = formData.get("avatar");
  if (!(file instanceof File) || file.size === 0) {
    return { success: false, error: (await getTranslations("profile.errors"))("avatarMissing") };
  }
  // Server-side checks — the client's <input accept> and the browser-
  // reported File.type are both just hints an attacker fully controls
  // via a raw request; these are the checks that actually matter. The
  // browser-reported content type is a hint only — CloudinaryAvatarUploadService
  // re-checks this same allowlist, and additionally sniffs the file's actual
  // magic bytes (Module 33 — Security Hardening), as independent defense-in-depth.
  if (!ALLOWED_AVATAR_MIME_TYPES.includes(file.type as (typeof ALLOWED_AVATAR_MIME_TYPES)[number])) {
    return { success: false, error: (await getTranslations("profile.errors"))("avatarType") };
  }
  if (file.size > MAX_AVATAR_BYTES) {
    return { success: false, error: (await getTranslations("profile.errors"))("avatarTooLarge") };
  }

  // Module 33 — Security Hardening: uploads were previously unrestricted
  // in frequency — see FILE_UPLOAD_BY_USER's own doc comment
  // (rate-limit-policies.ts) for why that's a real resource-cost risk,
  // not just an auth-flow concern.
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
    await makeUploadAvatarUseCase().execute(user.id, buffer, file.type);
    revalidatePath("/profile");
    return { success: true };
  } catch (error) {
    return fromDomainError(error, "avatarFailed");
  }
}

export async function changePasswordAction(formData: unknown): Promise<ActionResult> {
  const user = await requireAuth();

  const parsed = changePasswordSchema.safeParse(formData);
  if (!parsed.success) {
    return invalidInput(parsed.error);
  }

  try {
    await makeChangePasswordUseCase().execute(
      user.id,
      parsed.data.currentPassword,
      parsed.data.newPassword,
    );
    return { success: true };
  } catch (error) {
    return fromDomainError(error, "passwordFailed");
  }
}

export async function deleteAccountAction(formData: unknown): Promise<ActionResult> {
  const user = await requireAuth();

  const parsed = deleteAccountSchema.safeParse(formData);
  if (!parsed.success) {
    return invalidInput(parsed.error);
  }

  try {
    await makeDeleteAccountUseCase().execute(user.id, parsed.data.password);
    return { success: true };
  } catch (error) {
    return fromDomainError(error, "deleteFailed");
  }
}
