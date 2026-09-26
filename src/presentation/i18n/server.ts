import "server-only";

import { getTranslations } from "next-intl/server";
import type { z } from "zod";

import { DomainError } from "@/domain/errors/domain-error";
import {
  firstLocalizedIssue,
  toTranslatedFieldErrors,
  type Translator,
} from "@/shared/i18n/validation-messages";

import { localizeError } from "./error-messages";

/**
 * Module 120 — Multilingual Localization: server-side (Server Actions,
 * Server Components, Route Handlers that answer a UI) helpers for turning
 * errors into text in the *request's* locale — the same locale
 * `src/i18n/request.ts` resolved for the page (account preference →
 * cookie → Accept-Language → Spanish).
 *
 * These are the only two things an `actions.ts` file needs:
 *
 * ```ts
 * const parsed = schema.safeParse(input);
 * if (!parsed.success) return { success: false, error: await localizeZodError(parsed.error) };
 * try { … } catch (error) {
 *   return { success: false, error: await localizeActionError(error, t("sendFailed")) };
 * }
 * ```
 */

/**
 * Localised message for anything a use case threw. Non-domain errors are
 * logged (they are bugs or infrastructure failures, never user input) and
 * replaced with `fallback` / `errors.generic` — exactly the existing
 * `fromDomainError` convention, now in the user's language.
 */
export async function localizeActionError(error: unknown, fallback?: string): Promise<string> {
  if (!(error instanceof DomainError)) console.error(error);
  const t = await getTranslations("errors");
  return localizeError(t as unknown as Translator, error, { fallback });
}

/** The first validation issue of a failed `safeParse`, localised. */
export async function localizeZodError(error: z.ZodError, fallback?: string): Promise<string> {
  const t = await getTranslations("validation");
  return firstLocalizedIssue(error, t as unknown as Translator, fallback);
}

/** Every validation issue, localised, keyed by field path (`fieldErrors` shape). */
export async function localizeZodFieldErrors(error: z.ZodError): Promise<Record<string, string[]>> {
  const t = await getTranslations("validation");
  return toTranslatedFieldErrors(error, t as unknown as Translator);
}
