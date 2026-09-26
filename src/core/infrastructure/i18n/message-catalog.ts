/**
 * Module 29 — Internationalization: the static message catalog.
 *
 * GENERATED SHAPE, HAND-MAINTAINED FILE. There is no build step behind
 * it — it is a plain, explicit list of every `(locale, namespace)` pair
 * the app ships, so the bundler can statically see (and code-split /
 * tree-shake) every translation file. A dynamic
 * `import(\`../../../i18n/messages/${locale}/${namespace}.json\`)` would be
 * shorter, but it defeats static analysis: webpack would have to inline
 * the entire directory as a require-context into every chunk that
 * touches translations, and a typo in a locale/namespace would only ever
 * surface at runtime.
 *
 * Module 120 — Multilingual Localization moved the per-namespace imports
 * into one static `src/i18n/messages/<locale>/index.ts` per locale (still
 * plain static imports — same bundler visibility, 12 lines here instead
 * of ~280). Adding a language is: add the code to `SUPPORTED_LOCALES`
 * (src/shared/i18n/locales.ts), add its `index.ts` + JSON files, and add
 * one line to `MESSAGE_CATALOG` below. Nothing else in the codebase
 * changes. `messages-completeness.test.ts` fails the build if the two
 * lists ever drift apart or a namespace file is missing a key that the
 * default locale has. See docs/MODULE_29_INTERNATIONALIZATION.md §7.
 */

import esCatalog from "@/i18n/messages/es";
import enCatalog from "@/i18n/messages/en";
import ukCatalog from "@/i18n/messages/uk";
import csCatalog from "@/i18n/messages/cs";
import deCatalog from "@/i18n/messages/de";
import frCatalog from "@/i18n/messages/fr";
import itCatalog from "@/i18n/messages/it";
import ptCatalog from "@/i18n/messages/pt";
import roCatalog from "@/i18n/messages/ro";
import plCatalog from "@/i18n/messages/pl";
import ruCatalog from "@/i18n/messages/ru";
import nlCatalog from "@/i18n/messages/nl";

import { SUPPORTED_LOCALES, type Locale } from "@/shared/i18n/locales";

/**
 * The default locale's catalog *type*. Module 120 uses it as next-intl's
 * `AppConfig["Messages"]` (see src/i18n/next-intl.d.ts), which makes
 * every `t("some.key")` call a compile-time check against the Spanish
 * (default, complete) catalog.
 */
export type DefaultLocaleMessages = typeof esCatalog;

/**
 * A namespace file: nested objects bottoming out in message strings.
 * Shaped exactly as next-intl's `AbstractIntlMessages` expects, which is
 * what lets `LocaleCatalog` below (a `Record<Namespace, NamespaceMessages>`
 * keyed by namespace) be handed to next-intl as a single `messages`
 * object unchanged — see `src/i18n/request.ts`.
 */
export type NamespaceMessages = { [key: string]: string | NamespaceMessages };

/**
 * Every namespace the app ships translations for. The single source of
 * truth for "which namespaces exist" — `Namespace` is derived from it,
 * so a namespace that is not listed here cannot be requested by
 * `getTranslations()`/`useTranslations()` at all (compile error, not a
 * runtime miss).
 */
export const NAMESPACES = [
  "common",
  "nav",
  "auth",
  "validation",
  "dashboard",
  "jobs",
  "profile",
  "settings",
  "notifications",
  "admin",
  "emails",
  "marketing",
  "errors",
  "enums",
  "ui",
  "customer",
  "professional",
  "company",
  "partner",
  "services",
  "knowledge",
  "seo",
  "notificationTemplates",
] as const;

export type Namespace = (typeof NAMESPACES)[number];

/** All namespaces of one locale, keyed by namespace name. */
export type LocaleCatalog = Record<Namespace, NamespaceMessages>;

/**
 * The catalog itself. `Record<Locale, ...>` (not a partial) is what makes
 * "every supported locale must have every namespace" a type error rather
 * than a runtime `undefined`.
 */
export const MESSAGE_CATALOG: Record<Locale, LocaleCatalog> = {
  es: esCatalog,
  en: enCatalog,
  uk: ukCatalog,
  cs: csCatalog,
  de: deCatalog,
  fr: frCatalog,
  it: itCatalog,
  pt: ptCatalog,
  ro: roCatalog,
  pl: plCatalog,
  ru: ruCatalog,
  nl: nlCatalog,
};

/**
 * Runtime read of the catalog. Never indexes with an unchecked string:
 * `Locale` is a closed union and `MESSAGE_CATALOG` is a total record over
 * it, so this is total by construction — but the explicit guard keeps it
 * honest under `noUncheckedIndexedAccess` and keeps a hand-edited
 * catalog from silently returning `undefined`.
 */
export function getLocaleCatalog(locale: Locale): LocaleCatalog {
  const catalog = MESSAGE_CATALOG[locale];
  if (!catalog) {
    throw new Error(
      `No message catalog for locale "${locale}". Supported: ${SUPPORTED_LOCALES.join(", ")}.`,
    );
  }
  return catalog;
}
