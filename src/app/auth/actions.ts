"use server";

import { DomainError } from "@/domain/errors/domain-error";
import {
  forgotPasswordSchema,
  registerSchema,
  resetPasswordSchema,
  verifyEmailSchema,
} from "@/application/dto/auth.dto";
import {
  makeRegisterUserUseCase,
  makeRequestPasswordResetUseCase,
  makeResetPasswordUseCase,
  makeVerifyEmailUseCase,
} from "@/application/use-cases/auth/compose";

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

export async function registerAction(formData: unknown): Promise<ActionResult> {
  const parsed = registerSchema.safeParse(formData);
  if (!parsed.success) {
    return {
      success: false,
      error: "Please fix the errors below.",
      fieldErrors: parsed.error.flatten().fieldErrors,
    };
  }

  try {
    await makeRegisterUserUseCase().execute(parsed.data);
    return { success: true };
  } catch (error) {
    return fromDomainError(error, "Something went wrong creating your account.");
  }
}

export async function forgotPasswordAction(formData: unknown): Promise<ActionResult> {
  const parsed = forgotPasswordSchema.safeParse(formData);
  if (!parsed.success) {
    return {
      success: false,
      error: "Enter a valid email address.",
      fieldErrors: parsed.error.flatten().fieldErrors,
    };
  }

  try {
    await makeRequestPasswordResetUseCase().execute(parsed.data.email);
    return { success: true };
  } catch (error) {
    return fromDomainError(error, "Something went wrong. Please try again.");
  }
}

export async function resetPasswordAction(formData: unknown): Promise<ActionResult> {
  const parsed = resetPasswordSchema.safeParse(formData);
  if (!parsed.success) {
    return {
      success: false,
      error: "Please fix the errors below.",
      fieldErrors: parsed.error.flatten().fieldErrors,
    };
  }

  try {
    await makeResetPasswordUseCase().execute(parsed.data.token, parsed.data.password);
    return { success: true };
  } catch (error) {
    return fromDomainError(error, "Something went wrong resetting your password.");
  }
}

export async function verifyEmailAction(formData: unknown): Promise<ActionResult> {
  const parsed = verifyEmailSchema.safeParse(formData);
  if (!parsed.success) {
    return { success: false, error: "Missing or invalid verification token." };
  }

  try {
    await makeVerifyEmailUseCase().execute(parsed.data.token);
    return { success: true };
  } catch (error) {
    return fromDomainError(error, "Something went wrong verifying your email.");
  }
}
