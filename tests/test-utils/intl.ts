import { createElement, type ReactElement, type ReactNode } from "react";
import { NextIntlClientProvider } from "next-intl";
import { createFormatter, createTranslator } from "use-intl/core";

import { getMessages } from "@/infrastructure/i18n/message-loader";
import type { Locale } from "@/shared/i18n/locales";

/**
 * Module 120 — Multilingual Localization: test helpers.
 *
 * `tests/test-utils/intl-setup.ts` (a Vitest `setupFiles` entry) mocks
 * `next-intl/server` and makes `next-intl`'s client hooks fall back to
 * this module's *test locale* whenever a component is rendered without a
 * `NextIntlClientProvider` — so the ~200 existing component/action tests
 * keep rendering real catalog text (English by default, matching what
 * they already assert) without each wrapping itself in a provider.
 *
 * Tests that care about a specific language call `setTestLocale("ru")`
 * (reset automatically after each test) or render inside
 * `withIntl(ui, "nl")`, which uses the real provider.
 */

export const DEFAULT_TEST_LOCALE: Locale = "en";

let currentLocale: Locale = DEFAULT_TEST_LOCALE;

export function setTestLocale(locale: Locale): void {
  currentLocale = locale;
}

export function getTestLocale(): Locale {
  return currentLocale;
}

export function resetTestLocale(): void {
  currentLocale = DEFAULT_TEST_LOCALE;
}

export function testTranslator(namespace?: string, locale: Locale = currentLocale) {
  return createTranslator({
    locale,
    messages: getMessages(locale) as never,
    namespace: namespace as never,
    timeZone: "Europe/Madrid",
  });
}

export function testFormatter(locale: Locale = currentLocale) {
  return createFormatter({ locale, timeZone: "Europe/Madrid" });
}

/** Wrap `ui` in the real `NextIntlClientProvider` for `locale`. */
export function withIntl(ui: ReactNode, locale: Locale = currentLocale): ReactElement {
  const props = { locale, messages: getMessages(locale) as never, timeZone: "Europe/Madrid" };
  return createElement(NextIntlClientProvider, props as never, ui);
}
