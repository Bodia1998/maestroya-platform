/**
 * Module 29 — Internationalization: the hook entry point.
 *
 * `useTranslations`, `useLocale` and `useFormatter` are next-intl's own
 * hooks, re-exported here so a component only ever imports from
 * `@/hooks/use-i18n` rather than knowing that some hooks come from
 * `next-intl` and others (`useI18n`, the switch-state hook) come from the
 * app's own provider. `useI18n` still lives with its provider (a React
 * context and the hook that reads it cannot be split across module
 * boundaries without creating two contexts) — this file re-exports it
 * too, because `src/presentation/hooks/` is where this codebase's
 * conventions say a component looks for hooks.
 */
export { useFormatter, useLocale, useTranslations } from "next-intl";
export { I18nProvider, useI18n } from "@/components/shared/i18n-provider";
export type { I18nContextValue } from "@/components/shared/i18n-provider";
