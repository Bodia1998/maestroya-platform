import "server-only";

import { getTranslations } from "next-intl/server";

import type { DefaultLocaleMessages } from "@/infrastructure/i18n/message-catalog";
import { localizeActionError } from "@/presentation/i18n/server";

/** A key of `admin.actionErrors` — the localized fallback shown when a use case fails unexpectedly. */
export type AdminActionErrorKey = keyof DefaultLocaleMessages["admin"]["actionErrors"];

/**
 * Module 120 — Multilingual Localization: the admin Server Actions' shared
 * failure adapter (replaces each `actions.ts`'s local `fromDomainError`).
 * Domain errors are localized through `localizeActionError`; anything else
 * is logged there and replaced with the `admin.actionErrors.<key>` fallback
 * in the request's locale.
 */
export async function adminActionFailure(
  error: unknown,
  fallbackKey: AdminActionErrorKey,
): Promise<{ success: false; error: string }> {
  const t = await getTranslations("admin.actionErrors");
  return { success: false, error: await localizeActionError(error, t(fallbackKey)) };
}
