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
 * Adding a language is exactly two mechanical steps — add the code to
 * `SUPPORTED_LOCALES` (src/shared/i18n/locales.ts) and add its block
 * here — plus dropping the JSON files in. Nothing else in the codebase
 * changes. `messages-completeness.test.ts` fails the build if the two
 * lists ever drift apart or a namespace file is missing a key that the
 * default locale has. See docs/MODULE_29_INTERNATIONALIZATION.md §7.
 */

import es_common from "@/i18n/messages/es/common.json";
import es_nav from "@/i18n/messages/es/nav.json";
import es_auth from "@/i18n/messages/es/auth.json";
import es_validation from "@/i18n/messages/es/validation.json";
import es_dashboard from "@/i18n/messages/es/dashboard.json";
import es_jobs from "@/i18n/messages/es/jobs.json";
import es_profile from "@/i18n/messages/es/profile.json";
import es_settings from "@/i18n/messages/es/settings.json";
import es_notifications from "@/i18n/messages/es/notifications.json";
import es_admin from "@/i18n/messages/es/admin.json";
import es_emails from "@/i18n/messages/es/emails.json";
import es_marketing from "@/i18n/messages/es/marketing.json";
import en_common from "@/i18n/messages/en/common.json";
import en_nav from "@/i18n/messages/en/nav.json";
import en_auth from "@/i18n/messages/en/auth.json";
import en_validation from "@/i18n/messages/en/validation.json";
import en_dashboard from "@/i18n/messages/en/dashboard.json";
import en_jobs from "@/i18n/messages/en/jobs.json";
import en_profile from "@/i18n/messages/en/profile.json";
import en_settings from "@/i18n/messages/en/settings.json";
import en_notifications from "@/i18n/messages/en/notifications.json";
import en_admin from "@/i18n/messages/en/admin.json";
import en_emails from "@/i18n/messages/en/emails.json";
import en_marketing from "@/i18n/messages/en/marketing.json";
import uk_common from "@/i18n/messages/uk/common.json";
import uk_nav from "@/i18n/messages/uk/nav.json";
import uk_auth from "@/i18n/messages/uk/auth.json";
import uk_validation from "@/i18n/messages/uk/validation.json";
import uk_dashboard from "@/i18n/messages/uk/dashboard.json";
import uk_jobs from "@/i18n/messages/uk/jobs.json";
import uk_profile from "@/i18n/messages/uk/profile.json";
import uk_settings from "@/i18n/messages/uk/settings.json";
import uk_notifications from "@/i18n/messages/uk/notifications.json";
import uk_admin from "@/i18n/messages/uk/admin.json";
import uk_emails from "@/i18n/messages/uk/emails.json";
import uk_marketing from "@/i18n/messages/uk/marketing.json";
import cs_common from "@/i18n/messages/cs/common.json";
import cs_nav from "@/i18n/messages/cs/nav.json";
import cs_auth from "@/i18n/messages/cs/auth.json";
import cs_validation from "@/i18n/messages/cs/validation.json";
import cs_dashboard from "@/i18n/messages/cs/dashboard.json";
import cs_jobs from "@/i18n/messages/cs/jobs.json";
import cs_profile from "@/i18n/messages/cs/profile.json";
import cs_settings from "@/i18n/messages/cs/settings.json";
import cs_notifications from "@/i18n/messages/cs/notifications.json";
import cs_admin from "@/i18n/messages/cs/admin.json";
import cs_emails from "@/i18n/messages/cs/emails.json";
import cs_marketing from "@/i18n/messages/cs/marketing.json";
import de_common from "@/i18n/messages/de/common.json";
import de_nav from "@/i18n/messages/de/nav.json";
import de_auth from "@/i18n/messages/de/auth.json";
import de_validation from "@/i18n/messages/de/validation.json";
import de_dashboard from "@/i18n/messages/de/dashboard.json";
import de_jobs from "@/i18n/messages/de/jobs.json";
import de_profile from "@/i18n/messages/de/profile.json";
import de_settings from "@/i18n/messages/de/settings.json";
import de_notifications from "@/i18n/messages/de/notifications.json";
import de_admin from "@/i18n/messages/de/admin.json";
import de_emails from "@/i18n/messages/de/emails.json";
import de_marketing from "@/i18n/messages/de/marketing.json";
import fr_common from "@/i18n/messages/fr/common.json";
import fr_nav from "@/i18n/messages/fr/nav.json";
import fr_auth from "@/i18n/messages/fr/auth.json";
import fr_validation from "@/i18n/messages/fr/validation.json";
import fr_dashboard from "@/i18n/messages/fr/dashboard.json";
import fr_jobs from "@/i18n/messages/fr/jobs.json";
import fr_profile from "@/i18n/messages/fr/profile.json";
import fr_settings from "@/i18n/messages/fr/settings.json";
import fr_notifications from "@/i18n/messages/fr/notifications.json";
import fr_admin from "@/i18n/messages/fr/admin.json";
import fr_emails from "@/i18n/messages/fr/emails.json";
import fr_marketing from "@/i18n/messages/fr/marketing.json";
import it_common from "@/i18n/messages/it/common.json";
import it_nav from "@/i18n/messages/it/nav.json";
import it_auth from "@/i18n/messages/it/auth.json";
import it_validation from "@/i18n/messages/it/validation.json";
import it_dashboard from "@/i18n/messages/it/dashboard.json";
import it_jobs from "@/i18n/messages/it/jobs.json";
import it_profile from "@/i18n/messages/it/profile.json";
import it_settings from "@/i18n/messages/it/settings.json";
import it_notifications from "@/i18n/messages/it/notifications.json";
import it_admin from "@/i18n/messages/it/admin.json";
import it_emails from "@/i18n/messages/it/emails.json";
import it_marketing from "@/i18n/messages/it/marketing.json";
import pt_common from "@/i18n/messages/pt/common.json";
import pt_nav from "@/i18n/messages/pt/nav.json";
import pt_auth from "@/i18n/messages/pt/auth.json";
import pt_validation from "@/i18n/messages/pt/validation.json";
import pt_dashboard from "@/i18n/messages/pt/dashboard.json";
import pt_jobs from "@/i18n/messages/pt/jobs.json";
import pt_profile from "@/i18n/messages/pt/profile.json";
import pt_settings from "@/i18n/messages/pt/settings.json";
import pt_notifications from "@/i18n/messages/pt/notifications.json";
import pt_admin from "@/i18n/messages/pt/admin.json";
import pt_emails from "@/i18n/messages/pt/emails.json";
import pt_marketing from "@/i18n/messages/pt/marketing.json";
import ro_common from "@/i18n/messages/ro/common.json";
import ro_nav from "@/i18n/messages/ro/nav.json";
import ro_auth from "@/i18n/messages/ro/auth.json";
import ro_validation from "@/i18n/messages/ro/validation.json";
import ro_dashboard from "@/i18n/messages/ro/dashboard.json";
import ro_jobs from "@/i18n/messages/ro/jobs.json";
import ro_profile from "@/i18n/messages/ro/profile.json";
import ro_settings from "@/i18n/messages/ro/settings.json";
import ro_notifications from "@/i18n/messages/ro/notifications.json";
import ro_admin from "@/i18n/messages/ro/admin.json";
import ro_emails from "@/i18n/messages/ro/emails.json";
import ro_marketing from "@/i18n/messages/ro/marketing.json";
import pl_common from "@/i18n/messages/pl/common.json";
import pl_nav from "@/i18n/messages/pl/nav.json";
import pl_auth from "@/i18n/messages/pl/auth.json";
import pl_validation from "@/i18n/messages/pl/validation.json";
import pl_dashboard from "@/i18n/messages/pl/dashboard.json";
import pl_jobs from "@/i18n/messages/pl/jobs.json";
import pl_profile from "@/i18n/messages/pl/profile.json";
import pl_settings from "@/i18n/messages/pl/settings.json";
import pl_notifications from "@/i18n/messages/pl/notifications.json";
import pl_admin from "@/i18n/messages/pl/admin.json";
import pl_emails from "@/i18n/messages/pl/emails.json";
import pl_marketing from "@/i18n/messages/pl/marketing.json";

import { SUPPORTED_LOCALES, type Locale } from "@/shared/i18n/locales";

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
  es: {
    common: es_common,
    nav: es_nav,
    auth: es_auth,
    validation: es_validation,
    dashboard: es_dashboard,
    jobs: es_jobs,
    profile: es_profile,
    settings: es_settings,
    notifications: es_notifications,
    admin: es_admin,
    emails: es_emails,
    marketing: es_marketing,
  },
  en: {
    common: en_common,
    nav: en_nav,
    auth: en_auth,
    validation: en_validation,
    dashboard: en_dashboard,
    jobs: en_jobs,
    profile: en_profile,
    settings: en_settings,
    notifications: en_notifications,
    admin: en_admin,
    emails: en_emails,
    marketing: en_marketing,
  },
  uk: {
    common: uk_common,
    nav: uk_nav,
    auth: uk_auth,
    validation: uk_validation,
    dashboard: uk_dashboard,
    jobs: uk_jobs,
    profile: uk_profile,
    settings: uk_settings,
    notifications: uk_notifications,
    admin: uk_admin,
    emails: uk_emails,
    marketing: uk_marketing,
  },
  cs: {
    common: cs_common,
    nav: cs_nav,
    auth: cs_auth,
    validation: cs_validation,
    dashboard: cs_dashboard,
    jobs: cs_jobs,
    profile: cs_profile,
    settings: cs_settings,
    notifications: cs_notifications,
    admin: cs_admin,
    emails: cs_emails,
    marketing: cs_marketing,
  },
  de: {
    common: de_common,
    nav: de_nav,
    auth: de_auth,
    validation: de_validation,
    dashboard: de_dashboard,
    jobs: de_jobs,
    profile: de_profile,
    settings: de_settings,
    notifications: de_notifications,
    admin: de_admin,
    emails: de_emails,
    marketing: de_marketing,
  },
  fr: {
    common: fr_common,
    nav: fr_nav,
    auth: fr_auth,
    validation: fr_validation,
    dashboard: fr_dashboard,
    jobs: fr_jobs,
    profile: fr_profile,
    settings: fr_settings,
    notifications: fr_notifications,
    admin: fr_admin,
    emails: fr_emails,
    marketing: fr_marketing,
  },
  it: {
    common: it_common,
    nav: it_nav,
    auth: it_auth,
    validation: it_validation,
    dashboard: it_dashboard,
    jobs: it_jobs,
    profile: it_profile,
    settings: it_settings,
    notifications: it_notifications,
    admin: it_admin,
    emails: it_emails,
    marketing: it_marketing,
  },
  pt: {
    common: pt_common,
    nav: pt_nav,
    auth: pt_auth,
    validation: pt_validation,
    dashboard: pt_dashboard,
    jobs: pt_jobs,
    profile: pt_profile,
    settings: pt_settings,
    notifications: pt_notifications,
    admin: pt_admin,
    emails: pt_emails,
    marketing: pt_marketing,
  },
  ro: {
    common: ro_common,
    nav: ro_nav,
    auth: ro_auth,
    validation: ro_validation,
    dashboard: ro_dashboard,
    jobs: ro_jobs,
    profile: ro_profile,
    settings: ro_settings,
    notifications: ro_notifications,
    admin: ro_admin,
    emails: ro_emails,
    marketing: ro_marketing,
  },
  pl: {
    common: pl_common,
    nav: pl_nav,
    auth: pl_auth,
    validation: pl_validation,
    dashboard: pl_dashboard,
    jobs: pl_jobs,
    profile: pl_profile,
    settings: pl_settings,
    notifications: pl_notifications,
    admin: pl_admin,
    emails: pl_emails,
    marketing: pl_marketing,
  },
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
