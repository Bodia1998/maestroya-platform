import { DEFAULT_LOCALE } from "@/shared/i18n/locales";
import { formatMessage, type MessageValues } from "@/shared/i18n/message-format";

/**
 * Module 29 — Internationalization: the `t()` function.
 *
 * Shaped after `next-intl`'s `useTranslations(namespace)` / `getTranslations(namespace)`
 * return value on purpose (`t(key, values)`, `t.has(key)`, `t.raw(key)`),
 * so call sites are library-agnostic — see message-format.ts's header for
 * why the renderer lives in this repo. Every component in the app calls
 * `t(...)` and nothing else; the seam is here.
 */

/** A namespace file: nested objects bottoming out in ICU message strings. */
export type NamespaceMessages = { [key: string]: string | NamespaceMessages };

export interface Translator {
  (key: string, values?: MessageValues): string;
  /** True if `key` resolves to a message. For optional/conditional copy. */
  has(key: string): boolean;
  /** The unrendered template — for tests and for passing to another formatter. */
  raw(key: string): string | undefined;
}

export interface CreateTranslatorOptions {
  locale: string;
  /** The already-resolved namespace object (fallback-merged, see message-loader). */
  messages: NamespaceMessages;
  /** Only used to build a readable fallback string for a missing key. */
  namespace?: string;
  /**
   * Called instead of `console.warn` when a key is missing. Injected by
   * tests to assert on misses without polluting test output; production
   * leaves it unset and gets a dev-only warning.
   */
  onMissingKey?: (fullKey: string) => void;
}

function lookup(messages: NamespaceMessages, key: string): string | undefined {
  let current: string | NamespaceMessages | undefined = messages;
  for (const segment of key.split(".")) {
    if (typeof current !== "object" || current === null) return undefined;
    current = current[segment];
  }
  return typeof current === "string" ? current : undefined;
}

/**
 * A missing key renders as `namespace.key` rather than an empty string or
 * a thrown error. Rationale: an empty string produces a silently broken
 * layout that nobody notices in review, and throwing turns a content bug
 * into a 500. A visible `settings.language.titel` in the UI is
 * self-diagnosing — and `messages-completeness.test.ts` means it should
 * never reach a deploy in the first place.
 */
export function createTranslator({
  locale,
  messages,
  namespace,
  onMissingKey,
}: CreateTranslatorOptions): Translator {
  const qualify = (key: string) => (namespace ? `${namespace}.${key}` : key);

  const translate = (key: string, values?: MessageValues): string => {
    const template = lookup(messages, key);
    if (template === undefined) {
      const fullKey = qualify(key);
      if (onMissingKey) {
        onMissingKey(fullKey);
      } else if (process.env.NODE_ENV !== "production") {
        console.warn(`[i18n] Missing message "${fullKey}" for locale "${locale}".`);
      }
      return fullKey;
    }
    return formatMessage(template, values, locale);
  };

  const translator = translate as Translator;
  translator.has = (key: string) => lookup(messages, key) !== undefined;
  translator.raw = (key: string) => lookup(messages, key);
  return translator;
}

/**
 * Deep-merges a locale's namespace over the default locale's, so an
 * incomplete translation degrades key-by-key to Spanish instead of
 * rendering a raw key. Pure and side-effect-free — neither input is
 * mutated, because both are module-level imported JSON objects shared
 * across every request in the process.
 */
export function mergeWithFallback(
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

export const FALLBACK_LOCALE = DEFAULT_LOCALE;
