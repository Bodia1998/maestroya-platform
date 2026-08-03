import { describe, expect, it } from "vitest";

import {
  MESSAGE_CATALOG,
  NAMESPACES,
  getLocaleCatalog,
} from "@/infrastructure/i18n/message-catalog";
import { getMessages, getNamespaceMessages } from "@/infrastructure/i18n/message-loader";
import { formatMessage } from "@/shared/i18n/message-format";
import { DEFAULT_LOCALE, SUPPORTED_LOCALES } from "@/shared/i18n/locales";
import type { NamespaceMessages } from "@/shared/i18n/translator";

function flatten(messages: NamespaceMessages, prefix = ""): Map<string, string> {
  const flat = new Map<string, string>();
  for (const [key, value] of Object.entries(messages)) {
    const path = prefix ? `${prefix}.${key}` : key;
    if (typeof value === "string") flat.set(path, value);
    else for (const [k, v] of flatten(value, path)) flat.set(k, v);
  }
  return flat;
}

/**
 * The guard rail behind the "adding a language is translation-files-only"
 * promise. If `SUPPORTED_LOCALES` and the catalog ever drift apart, or a
 * translator's file is missing a key the default locale has, or a message
 * uses ICU syntax this platform's renderer does not implement, it fails
 * here rather than rendering a raw key to a user.
 */
describe("message catalog completeness", () => {
  it("covers every supported locale, and nothing else", () => {
    expect(Object.keys(MESSAGE_CATALOG).sort()).toEqual([...SUPPORTED_LOCALES].sort());
  });

  it("gives every locale every namespace", () => {
    for (const locale of SUPPORTED_LOCALES) {
      expect(Object.keys(getLocaleCatalog(locale)).sort()).toEqual([...NAMESPACES].sort());
    }
  });

  it.each(SUPPORTED_LOCALES.filter((locale) => locale !== DEFAULT_LOCALE))(
    "%s has every key the default locale has",
    (locale) => {
      for (const namespace of NAMESPACES) {
        const expected = [...flatten(getLocaleCatalog(DEFAULT_LOCALE)[namespace]).keys()].sort();
        const actual = [...flatten(getLocaleCatalog(locale)[namespace]).keys()].sort();
        expect(actual, `${locale}/${namespace}`).toEqual(expected);
      }
    },
  );

  it("has no empty messages", () => {
    for (const locale of SUPPORTED_LOCALES) {
      for (const namespace of NAMESPACES) {
        for (const [key, value] of flatten(getLocaleCatalog(locale)[namespace])) {
          expect(value.trim(), `${locale}/${namespace}/${key}`).not.toBe("");
        }
      }
    }
  });

  it("renders every shipped message without throwing and without leaking braces", () => {
    // Values cover every argument name used across the catalog.
    const values = {
      name: "Ana",
      language: "Polski",
      count: 2,
      min: 2,
      max: 10,
      year: 2026,
      date: new Date(Date.UTC(2026, 0, 15, 9, 30, 0)),
    };

    for (const locale of SUPPORTED_LOCALES) {
      for (const namespace of NAMESPACES) {
        for (const [key, template] of flatten(getLocaleCatalog(locale)[namespace])) {
          const rendered = formatMessage(template, values, locale);
          expect(rendered, `${locale}/${namespace}/${key}`).not.toContain("{");
          expect(rendered, `${locale}/${namespace}/${key}`).not.toContain("}");
        }
      }
    }
  });

  it("keeps plural-bearing messages correct in each language's own categories", () => {
    // Polish 'few' (2-4) vs 'many' (5+) — a two-branch English-shaped
    // translation would render identically for 3 and 5.
    const pl = getNamespaceMessages("pl", "jobs");
    const three = formatMessage(flatten(pl).get("count")!, { count: 3 }, "pl");
    const five = formatMessage(flatten(pl).get("count")!, { count: 5 }, "pl");
    expect(three).not.toBe(five);
  });
});

describe("fallback merging", () => {
  it("returns the default locale's catalog unchanged", () => {
    expect(getMessages(DEFAULT_LOCALE)).toBe(getLocaleCatalog(DEFAULT_LOCALE));
  });

  it("memoises per locale", () => {
    expect(getMessages("uk")).toBe(getMessages("uk"));
  });

  it("does not mutate the imported JSON while merging", () => {
    const before = JSON.stringify(getLocaleCatalog(DEFAULT_LOCALE).common);
    getMessages("cs");
    expect(JSON.stringify(getLocaleCatalog(DEFAULT_LOCALE).common)).toBe(before);
  });
});
