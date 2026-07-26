"use server";

import { DomainError, RateLimitedError } from "@/domain/errors/domain-error";
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
import { makeAntiAbuseService } from "@/application/use-cases/security/compose";
import { getClientIpHash } from "@/infrastructure/auth/request-context";

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

/**
 * Registration abuse (Module 24, threat B): one shared IP-based policy —
 * there's no user identity yet at this point in the flow, so IP is the
 * only signal available. A hashed IP (never raw — see
 * infrastructure/auth/request-context.ts) with no signal at all (e.g. a
 * proxy that strips forwarding headers) is allowed through unlimited,
 * same trade-off every IP-based policy here makes; see
 * docs/MODULE_24_SECURITY_ANTI_ABUSE.md.
 */
export async function registerAction(formData: unknown): Promise<ActionResult> {
  const parsed = registerSchema.safeParse(formData);
  if (!parsed.success) {
    return {
      success: false,
      error: "Please fix the errors below.",
      fieldErrors: parsed.error.flatten().fieldErrors,
    };
  }

  const ipHash = await getClientIpHash();
  const antiAbuse = makeAntiAbuseService();
  if (ipHash) {
    try {
      await antiAbuse.enforceRateLimit("REGISTRATION_BY_IP", { ipHash }, "RATE_LIMIT_TRIGGERED");
    } catch (error) {
      if (error instanceof RateLimitedError) {
        return { success: false, error: error.message };
      }
      throw error;
    }
  }

  try {
    const { userId } = await makeRegisterUserUseCase().execute(parsed.data);
    await antiAbuse.recordEvent({ type: "ACCOUNT_CREATED", userId, ipHash });
    return { success: true };
  } catch (error) {
    return fromDomainError(error, "Something went wrong creating your account.");
  }
}

/**
 * Password reset flooding (Module 24, threat A) — enforced *before*
 * RequestPasswordResetUseCase runs, so a flood is rejected without even
 * reaching the (already anti-enumeration-safe, see that use case's own
 * doc comment) email lookup. Keyed by email *and* IP, both enforced —
 * see rate-limit-policies.ts's own doc comment for why both matter.
 */
export async function forgotPasswordAction(formData: unknown): Promise<ActionResult> {
  const parsed = forgotPasswordSchema.safeParse(formData);
  if (!parsed.success) {
    return {
      success: false,
      error: "Enter a valid email address.",
      fieldErrors: parsed.error.flatten().fieldErrors,
    };
  }

  const ipHash = await getClientIpHash();
  const antiAbuse = makeAntiAbuseService();
  try {
    await antiAbuse.enforceRateLimit(
      "PASSWORD_RESET_REQUEST_BY_EMAIL",
      { resource: parsed.data.email },
      "RATE_LIMIT_TRIGGERED",
    );
    if (ipHash) {
      await antiAbuse.enforceRateLimit("PASSWORD_RESET_REQUEST_BY_IP", { ipHash }, "RATE_LIMIT_TRIGGERED");
    }
  } catch (error) {
    if (error instanceof RateLimitedError) {
      // Same message either way — never confirm/deny via a *different*
      // rate-limit message whether the email exists (that would reopen
      // the exact enumeration hole RequestPasswordResetUseCase's own doc
      // comment already avoids).
      return { success: false, error: "Something went wrong. Please try again." };
    }
    throw error;
  }

  try {
    await makeRequestPasswordResetUseCase().execute(parsed.data.email);
    await antiAbuse.recordEvent({ type: "PASSWORD_RESET_REQUESTED", ipHash, metadata: null });
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
    await makeAntiAbuseService().recordEvent({ type: "PASSWORD_RESET_COMPLETED" });
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
