import type * as NextIntl from "next-intl";
import { afterEach, vi } from "vitest";

import {
  getTestLocale,
  resetTestLocale,
  testFormatter,
  testTranslator,
} from "./intl";

/**
 * Module 120 — Multilingual Localization: global Vitest setup (see
 * `tests/test-utils/intl.ts` for the rationale).
 *
 * - `next-intl/server`: resolved against the test locale — there is no
 *   Next.js request (cookies/headers) in a unit test.
 * - `next-intl` client hooks: the real hook when a provider is present
 *   (e.g. the language-switcher tests, `withIntl`), otherwise the test
 *   locale's catalog. The real hook throws synchronously on a missing
 *   provider before doing anything else, so the fallback path is stable
 *   across re-renders of the same tree.
 */
vi.mock("next-intl/server", () => ({
  getTranslations: async (arg?: string | { namespace?: string; locale?: string }) => {
    const namespace = typeof arg === "string" ? arg : arg?.namespace;
    return testTranslator(namespace);
  },
  getLocale: async () => getTestLocale(),
  getFormatter: async () => testFormatter(),
  getMessages: async () => (await import("@/infrastructure/i18n/message-loader")).getMessages(getTestLocale()),
  getNow: async () => new Date(),
  getTimeZone: async () => "Europe/Madrid",
  setRequestLocale: () => undefined,
  getRequestConfig: (fn: unknown) => fn,
}));

vi.mock("next-intl", async (importOriginal) => {
  const actual = await importOriginal<typeof NextIntl>();
  const withFallback =
    <A extends unknown[], R>(real: (...args: A) => R, fallback: (...args: A) => R) =>
    (...args: A): R => {
      try {
        return real(...args);
      } catch (error) {
        if (error instanceof Error && /context|provider/i.test(error.message)) {
          return fallback(...args);
        }
        throw error;
      }
    };
  return {
    ...actual,
    useTranslations: withFallback(actual.useTranslations as (ns?: string) => unknown, (ns?: string) =>
      testTranslator(ns),
    ),
    useLocale: withFallback(actual.useLocale, () => getTestLocale()),
    useFormatter: withFallback(actual.useFormatter as () => unknown, () => testFormatter()),
    useNow: withFallback(actual.useNow as () => unknown, () => new Date()),
    useTimeZone: withFallback(actual.useTimeZone as () => unknown, () => "Europe/Madrid"),
  };
});

afterEach(() => {
  resetTestLocale();
});
