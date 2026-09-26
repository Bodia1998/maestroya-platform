import type { DefaultLocaleMessages } from "@/infrastructure/i18n/message-catalog";

/**
 * Module 120 — Multilingual Localization: typed translation keys.
 *
 * Registers the default (Spanish, always-complete) catalog's shape as
 * next-intl's `AppConfig["Messages"]`, so `useTranslations("ns")` /
 * `getTranslations("ns")` only accept namespaces that exist and `t(key)`
 * only accepts keys that exist in the Spanish catalog. A typo or a key
 * that was never added to `es` is a `tsc` error instead of a raw key on
 * screen. Parity of the *other* locales with `es` is enforced at test
 * time by `messages-completeness.test.ts`.
 */
declare module "next-intl" {
  interface AppConfig {
    Messages: DefaultLocaleMessages;
  }
}
