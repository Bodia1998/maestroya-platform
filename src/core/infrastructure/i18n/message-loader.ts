import { DEFAULT_LOCALE, type Locale } from "@/shared/i18n/locales";
import { mergeWithFallback, type NamespaceMessages } from "@/shared/i18n/translator";
import {
  NAMESPACES,
  getLocaleCatalog,
  type LocaleCatalog,
  type Namespace,
} from "@/infrastructure/i18n/message-catalog";

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
