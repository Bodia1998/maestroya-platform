import { DomainError, RateLimitedError } from "@/domain/errors/domain-error";
import type { Translator } from "@/shared/i18n/validation-messages";

import { DOMAIN_ERROR_MESSAGE_KEYS } from "./domain-error-message-keys";

/**
 * Module 120 — Multilingual Localization: user-facing error messages.
 *
 * ## Why this lives at the presentation edge
 *
 * Domain and application errors carry English *developer* messages (they
 * are also what ends up in logs, Sentry and audit trails) plus a stable
 * machine `code`. Neither the domain nor the use cases know which language
 * the person on the other end reads — and they must not: a locale is a
 * presentation concern. So instead of translating 600+ `throw` sites, the
 * edge (Server Actions, Route Handlers rendering to a UI, Server
 * Components) resolves what to *show* from the error it caught:
 *
 * 1. **Exact known message** → a specific localised sentence. The
 *    registry in `domain-error-message-keys.ts` maps a domain error's
 *    exact (static) English message to a key under `errors.domain.*`.
 *    `domain-error-message-keys.test.ts` asserts every registered message
 *    still exists verbatim in `src/`, so a reworded domain message makes a
 *    test fail instead of silently degrading.
 * 2. **Known error code** → a localised code-level sentence
 *    (`errors.byCode.<CODE>`), e.g. any `NOT_FOUND`, any `CONFLICT`.
 * 3. **Anything else** (a non-domain error, an unmapped code) → the
 *    caller's already-localised fallback, or `errors.generic`.
 *
 * The English developer message is therefore never shown to a user whose
 * interface is in another language, and the result is deterministic and
 * testable for every input.
 */

/** Codes that have their own user-facing sentence in `errors.byCode`. */
export const LOCALIZED_ERROR_CODES = [
  "NOT_FOUND",
  "VALIDATION_ERROR",
  "UNAUTHORIZED",
  "CONFLICT",
  "RATE_LIMITED",
  "ACCOUNT_RESTRICTED",
  "PROFESSIONAL_NOT_VERIFIED",
  "SELF_BILLING_NOT_AUTHORIZED",
  "BUSINESS_REGISTRATION_REQUIRED",
  "MATERIALS_NOT_CONFIRMED",
  "MATERIALS_LIST_REQUIRED",
  "PRICED_MATERIALS_NOT_ALLOWED",
  "PAYMENT_GATEWAY_ERROR",
  "STRIPE_CONNECT_ERROR",
  "STRIPE_TRANSFER_ERROR",
  "VERIFICATION_PROVIDER_ERROR",
  "REFERRAL_CODE_ERROR",
  "PARTNER_NOT_ACTIVE",
  "DUPLICATE_APPEAL",
  "UNSUPPORTED_COUNTRY",
  "TAX_CALCULATION_ERROR",
] as const;

export type LocalizedErrorCode = (typeof LOCALIZED_ERROR_CODES)[number];

const LOCALIZED_CODE_SET = new Set<string>(LOCALIZED_ERROR_CODES);

export interface LocalizeErrorOptions {
  /**
   * Already-localised message to use when nothing more specific applies
   * (typically the caller's own "Couldn't send the quote." string from its
   * feature namespace). Defaults to `errors.generic`.
   */
  fallback?: string;
}

/**
 * Resolve the message to show for `error`. `t` must be a translator bound
 * to the `errors` namespace (`getTranslations("errors")` /
 * `useTranslations("errors")`).
 */
export function localizeError(
  t: Translator,
  error: unknown,
  options: LocalizeErrorOptions = {},
): string {
  const fallback = options.fallback ?? t("generic");

  if (!(error instanceof DomainError) && !isDomainErrorLike(error)) return fallback;

  const { code, message } = error as { code: string; message: string };

  const key = DOMAIN_ERROR_MESSAGE_KEYS[message];
  if (key) return t(`domain.${key}`);

  if (error instanceof RateLimitedError && error.retryAfterMs > 0) {
    return t("rateLimitedRetry", { seconds: Math.max(1, Math.ceil(error.retryAfterMs / 1000)) });
  }

  if (LOCALIZED_CODE_SET.has(code)) return t(`byCode.${code}`);

  return fallback;
}

/**
 * Errors that crossed a serialisation boundary (e.g. a `{ code, message }`
 * JSON body from a Route Handler) are no longer `instanceof DomainError`,
 * but carry the same two fields and deserve the same treatment.
 */
function isDomainErrorLike(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    typeof (error as { code?: unknown }).code === "string" &&
    typeof (error as { message?: unknown }).message === "string"
  );
}
