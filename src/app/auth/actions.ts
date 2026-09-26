"use server";

import { cookies } from "next/headers";
import { getLocale, getTranslations } from "next-intl/server";

import { RateLimitedError } from "@/domain/errors/domain-error";
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
import { makeCollectFraudTrustSignalsUseCase } from "@/application/use-cases/trust-integrity/compose";
import { getClientIp, getClientIpHash } from "@/infrastructure/auth/request-context";
import { logger } from "@/infrastructure/observability/logger";
import { localizeActionError, localizeZodFieldErrors } from "@/presentation/i18n/server";

export type ActionResult =
  | { success: true }
  | { success: false; error: string; fieldErrors?: Record<string, string[]> };

/**
 * Module 120 — Multilingual Localization: a domain error's localised
 * message (see `localizeActionError`), else the caller's localised
 * fallback. Non-domain errors are still logged, exactly as before.
 */
async function fromDomainError(error: unknown, fallback: string): Promise<ActionResult> {
  return { success: false, error: await localizeActionError(error, fallback) };
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
  const t = await getTranslations("auth");
  const parsed = registerSchema.safeParse(formData);
  if (!parsed.success) {
    return {
      success: false,
      error: t("errors.fixBelow"),
      fieldErrors: await localizeZodFieldErrors(parsed.error),
    };
  }

  const ipHash = await getClientIpHash();
  const antiAbuse = makeAntiAbuseService();
  if (ipHash) {
    try {
      await antiAbuse.enforceRateLimit("REGISTRATION_BY_IP", { ipHash }, "RATE_LIMIT_TRIGGERED");
    } catch (error) {
      if (error instanceof RateLimitedError) {
        return { success: false, error: await localizeActionError(error) };
      }
      throw error;
    }
  }

  // Module 96 — Referral & Affiliate Production Wiring: `visitorId`
  // is resolved from the server-side `mv_visitor` cookie set by the
  // `/r/<code>` referral redirect (see that route's doc comment), never
  // trusted from client-submitted form data — a client could otherwise
  // submit an arbitrary visitorId to try to graft an unrelated
  // attribution/click history onto their own registration. Any
  // `visitorId` that slipped through `registerSchema` from the request
  // body is deliberately overwritten here.
  const cookieStore = await cookies();
  const visitorId = cookieStore.get("mv_visitor")?.value;
  const registerInput = { ...parsed.data, visitorId: visitorId || undefined };

  try {
    const { userId } = await makeRegisterUserUseCase().execute(registerInput, {
      // Module 120: the verification email goes out in the language the
      // visitor registered in.
      locale: await getLocale(),
    });
    await antiAbuse.recordEvent({ type: "ACCOUNT_CREATED", userId, ipHash });

    // Module 93 — Real Fraud & Trust Signal Providers: best-effort,
    // never blocks the response above (registration has already
    // succeeded by this point) — see CollectFraudTrustSignalsUseCase's
    // own "never blocks the caller" section. Raw `ip` is resolved here,
    // right before use, and never stored on `parsed.data`/`ipHash`/
    // anywhere else — see getClientIp's own doc comment.
    void collectRegistrationFraudTrustSignals(userId, ipHash, parsed.data.deviceSignal);

    return { success: true };
  } catch (error) {
    return fromDomainError(error, t("register.failed"));
  }
}

async function collectRegistrationFraudTrustSignals(
  userId: string,
  ipHash: string | null,
  deviceSignal: Record<string, unknown> | undefined,
): Promise<void> {
  try {
    const ip = await getClientIp();
    await makeCollectFraudTrustSignalsUseCase().execute({
      userId,
      deviceSignal: deviceSignal ? { rawSignal: deviceSignal } : undefined,
      vpnProxySignal: ipHash && ip ? { ipHash, ip } : undefined,
    });
  } catch (error) {
    logger.warn("fraud_signal_collection_unexpected_error", {
      userId,
      error: error instanceof Error ? error.message : String(error),
    });
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
  const t = await getTranslations("auth");
  const parsed = forgotPasswordSchema.safeParse(formData);
  if (!parsed.success) {
    return {
      success: false,
      error: t("forgotPassword.invalidEmail"),
      fieldErrors: await localizeZodFieldErrors(parsed.error),
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
      return { success: false, error: t("forgotPassword.failed") };
    }
    throw error;
  }

  try {
    await makeRequestPasswordResetUseCase().execute(parsed.data.email, {
      // Module 120: only used when the account has no stored preferredLocale.
      locale: await getLocale(),
    });
    await antiAbuse.recordEvent({ type: "PASSWORD_RESET_REQUESTED", ipHash, metadata: null });
    return { success: true };
  } catch (error) {
    return fromDomainError(error, t("forgotPassword.failed"));
  }
}

export async function resetPasswordAction(formData: unknown): Promise<ActionResult> {
  const t = await getTranslations("auth");
  const parsed = resetPasswordSchema.safeParse(formData);
  if (!parsed.success) {
    return {
      success: false,
      error: t("errors.fixBelow"),
      fieldErrors: await localizeZodFieldErrors(parsed.error),
    };
  }

  try {
    await makeResetPasswordUseCase().execute(parsed.data.token, parsed.data.password);
    await makeAntiAbuseService().recordEvent({ type: "PASSWORD_RESET_COMPLETED" });
    return { success: true };
  } catch (error) {
    return fromDomainError(error, t("resetPassword.failed"));
  }
}

export async function verifyEmailAction(formData: unknown): Promise<ActionResult> {
  const t = await getTranslations("auth");
  const parsed = verifyEmailSchema.safeParse(formData);
  if (!parsed.success) {
    return { success: false, error: t("verifyEmail.invalidToken") };
  }

  try {
    await makeVerifyEmailUseCase().execute(parsed.data.token);
    return { success: true };
  } catch (error) {
    return fromDomainError(error, t("verifyEmail.failed"));
  }
}
