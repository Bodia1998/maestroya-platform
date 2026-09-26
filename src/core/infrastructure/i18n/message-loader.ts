import { DEFAULT_LOCALE, type Locale } from "@/shared/i18n/locales";
import {
  NAMESPACES,
  getLocaleCatalog,
  type LocaleCatalog,
  type Namespace,
  type NamespaceMessages,
} from "@/infrastructure/i18n/message-catalog";

/**
 * Deep-merges a locale's namespace over the default locale's, so an
 * incomplete translation degrades key-by-key to Spanish instead of
 * rendering a raw key via next-intl's own missing-message fallback. Pure
 * and side-effect-free — neither input is mutated, because both are
 * module-level imported JSON objects shared across every request in the
 * process.
 */
function mergeWithFallback(
  fallback: NamespaceMessages,
  override: NamespaceMessages,
): NamespaceMessages {
  const merged: NamespaceMessages = { ...fallback };
  for (const [key, value] of Object.entries(override)) {
    const base = merged[key];
    if (typeof value === "object" && value !== null && typeof base === "object" && base !== null) {
      merged[key] = mergeWithFallback(base, value);
    } else {
      merged[key] = value;
    }
  }
  return merged;
}

/**
 * Module 29 — Internationalization: turns the static catalog into the
 * message objects a translator consumes.
 *
 * Two responsibilities, both of which have to happen exactly once per
 * process rather than once per render:
 *
 * 1. **Fallback merging.** Every non-default locale is deep-merged over
 *    Spanish, so a namespace that is missing a key (a language added
 *    mid-sprint, a key added to `es` but not yet translated) renders the
 *    Spanish string instead of a raw `settings.language.title`. Merging
 *    per render would allocate a fresh object graph for every component
 *    on every request.
 * 2. **Caching.** The merged result is memoised per locale. The catalog
 *    is imported JSON — immutable for the process lifetime — so the cache
 *    can never go stale, and `mergeWithFallback` never mutates its
 *    inputs, so the shared JSON objects stay pristine.
 *
 * Deliberately *not* marked `server-only`: the client provider needs the
 * exact same merged messages for the locale it is hydrating, and having
 * two merge implementations (one per environment) is how the server and
 * the client end up disagreeing about a string and producing a hydration
 * mismatch.
 */

const mergedCatalogs = new Map<Locale, LocaleCatalog>();

function buildMergedCatalog(locale: Locale): LocaleCatalog {
  const catalog = getLocaleCatalog(locale);
  if (locale === DEFAULT_LOCALE) return catalog;

  const fallback = getLocaleCatalog(DEFAULT_LOCALE);
  const merged = {} as LocaleCatalog;
  for (const namespace of NAMESPACES) {
    merged[namespace] = mergeWithFallback(fallback[namespace], catalog[namespace]);
  }
  return merged;
}

/** Every namespace for one locale, fallback-merged. */
export function getMessages(locale: Locale): LocaleCatalog {
  let merged = mergedCatalogs.get(locale);
  if (!merged) {
    merged = buildMergedCatalog(locale);
    mergedCatalogs.set(locale, merged);
  }
  return merged;
}

/** One namespace for one locale, fallback-merged. */
export function getNamespaceMessages(locale: Locale, namespace: Namespace): NamespaceMessages {
  return getMessages(locale)[namespace];
}

export { NAMESPACES };
export type { Namespace, LocaleCatalog };

/**
 * Module 120 — Multilingual Localization: namespaces that are only ever
 * read on the server (Server Components, Route Handlers, email/SMS
 * rendering) and are therefore never shipped to the browser inside
 * `NextIntlClientProvider`. Keeping them out is purely a bundle-size
 * measure — the catalog is ~12x larger than it was in Module 29.
 *
 * A Client Component that calls `useTranslations()` on one of these would
 * hit next-intl's missing-message handling; the rule is simply that these
 * namespaces are rendered by Server Components, which read the full
 * catalog through `src/i18n/request.ts`.
 */
export const SERVER_ONLY_NAMESPACES: readonly Namespace[] = ["emails", "seo", "knowledge"];

export interface ClientMessageOptions {
  /** Whether the viewer can reach `/admin` (ADMIN / SUPER_ADMIN). */
  includeAdmin: boolean;
}

/**
 * The subset of a locale's (already fallback-merged) messages handed to
 * `NextIntlClientProvider`. The admin namespace only reaches browsers of
 * users who can open the admin panel at all.
 */
export function selectClientMessages(
  messages: LocaleCatalog,
  options: ClientMessageOptions,
): Partial<LocaleCatalog> {
  const selected: Partial<LocaleCatalog> = {};
  for (const namespace of NAMESPACES) {
    if (SERVER_ONLY_NAMESPACES.includes(namespace)) continue;
    if (namespace === "admin" && !options.includeAdmin) continue;
    selected[namespace] = messages[namespace];
  }
  return selected;
}
