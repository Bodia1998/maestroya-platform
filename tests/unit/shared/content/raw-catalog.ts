import { createTranslator } from "use-intl/core";

import { getLocaleCatalog } from "@/infrastructure/i18n/message-catalog";
import type { Locale } from "@/shared/i18n/locales";

/**
 * Module 120 — a translator over ONE locale's own catalog, without the
 * Spanish fallback merge `getMessages()` applies — so `t.has(key)` is only
 * true when that locale really defines the key (used to assert the curated
 * knowledge content is translated in every locale, not silently falling
 * back to Spanish).
 */
export function rawTranslator(namespace: string, locale: Locale) {
  return createTranslator({
    locale,
    messages: getLocaleCatalog(locale) as never,
    namespace: namespace as never,
    timeZone: "Europe/Madrid",
  });
}
