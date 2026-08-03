/**
 * Module 29 — Internationalization: the hook entry point.
 *
 * The implementation lives with the provider (a React context and the
 * hooks that read it cannot be split across module boundaries without
 * creating two contexts), so this file is a re-export — it exists because
 * `src/presentation/hooks/` is where this codebase's conventions say a
 * component looks for hooks, and `import { useTranslations } from
 * "@/hooks/use-i18n"` should not require knowing which component file
 * happens to host the provider.
 */
export {
  useFormatter,
  useI18n,
  useLocale,
  useTranslations,
} from "@/components/shared/i18n-provider";
export type { I18nContextValue } from "@/components/shared/i18n-provider";
