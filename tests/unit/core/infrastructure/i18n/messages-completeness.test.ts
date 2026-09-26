import { parse, type MessageFormatElement } from "@formatjs/icu-messageformat-parser";
import { createTranslator } from "use-intl/core";
import { describe, expect, it } from "vitest";

import {
  MESSAGE_CATALOG,
  NAMESPACES,
  getLocaleCatalog,
  type Namespace,
  type NamespaceMessages,
} from "@/infrastructure/i18n/message-catalog";
import {
  SERVER_ONLY_NAMESPACES,
  getMessages,
  getNamespaceMessages,
  selectClientMessages,
} from "@/infrastructure/i18n/message-loader";
import { DEFAULT_LOCALE, SUPPORTED_LOCALES, type Locale } from "@/shared/i18n/locales";

/**
 * Module 29 (extended by Module 120 — Multilingual Localization): the
 * guard rail behind "every locale is complete".
 *
 * `es` is the source of truth (it is also the fallback locale, see
 * `message-loader.ts`). Every other locale must have exactly the same key
 * set, the same ICU arguments in every message, and must render with
 * next-intl's own engine without throwing or leaking a brace.
 *
 * The one intentional exception is `admin` (see
 * `PARTIAL_NAMESPACES` below): the admin panel is an internal staff tool
 * localised into Spanish and English only — a product decision recorded in
 * the Module 120 report. Other locales may carry a *subset* of its keys
 * (the pre-existing admin navigation keys), and anything missing falls
 * back deterministically to Spanish through the loader's merge.
 */

/** Namespaces that only `FULL_LOCALES_FOR_PARTIAL` must fully cover. */
const PARTIAL_NAMESPACES: ReadonlySet<Namespace> = new Set<Namespace>(["admin"]);
const FULL_LOCALES_FOR_PARTIAL: ReadonlySet<Locale> = new Set<Locale>(["es", "en"]);

function flatten(messages: NamespaceMessages, prefix = ""): Map<string, string> {
  const flat = new Map<string, string>();
  for (const [key, value] of Object.entries(messages)) {
    const path = prefix ? `${prefix}.${key}` : key;
    if (typeof value === "string") flat.set(path, value);
    else for (const [k, v] of flatten(value, path)) flat.set(k, v);
  }
  return flat;
}

type ArgKind = "text" | "number" | "date" | "tag";

/** Every ICU argument a message uses, with the kind of value it needs. */
function collectArguments(elements: MessageFormatElement[], out = new Map<string, ArgKind>()) {
  for (const el of elements) {
    switch (el.type) {
      case 1: // argument
        if (!out.has(el.value)) out.set(el.value, "text");
        break;
      case 2: // number
        out.set(el.value, "number");
        break;
      case 3: // date
      case 4: // time
        out.set(el.value, "date");
        break;
      case 5: // select
        if (!out.has(el.value)) out.set(el.value, "text");
        for (const option of Object.values(el.options)) collectArguments(option.value, out);
        break;
      case 6: // plural
        out.set(el.value, "number");
        for (const option of Object.values(el.options)) collectArguments(option.value, out);
        break;
      case 8: // tag
        out.set(el.value, "tag");
        collectArguments(el.children, out);
        break;
      default:
        break;
    }
  }
  return out;
}

function argumentsOf(template: string): Map<string, ArgKind> {
  return collectArguments(parse(template, { ignoreTag: false }));
}

function sampleValues(args: Map<string, ArgKind>): Record<string, unknown> {
  const values: Record<string, unknown> = {};
  for (const [name, kind] of args) {
    if (kind === "number") values[name] = 3;
    else if (kind === "date") values[name] = new Date(Date.UTC(2026, 0, 15, 9, 30, 0));
    else if (kind === "tag") values[name] = (chunks: unknown) => chunks;
    else values[name] = "X";
  }
  return values;
}

function render(namespace: string, key: string, template: string, locale: string): string {
  const t = createTranslator({
    locale,
    namespace,
    messages: { [namespace]: { k: template } },
    onError: (error) => {
      throw error;
    },
  });
  const values = sampleValues(argumentsOf(template));
  const hasTags = [...argumentsOf(template).values()].includes("tag");
  const output = hasTags
    ? String(t.rich("k" as never, values as never))
    : t("k" as never, values as never);
  return `${key}:${output}`;
}

const NON_DEFAULT_LOCALES = SUPPORTED_LOCALES.filter((locale) => locale !== DEFAULT_LOCALE);

describe("message catalog completeness", () => {
  it("covers every supported locale (including ru and nl), and nothing else", () => {
    expect(Object.keys(MESSAGE_CATALOG).sort()).toEqual([...SUPPORTED_LOCALES].sort());
    expect(SUPPORTED_LOCALES).toContain("ru");
    expect(SUPPORTED_LOCALES).toContain("nl");
  });

  it("gives every locale every namespace", () => {
    for (const locale of SUPPORTED_LOCALES) {
      expect(Object.keys(getLocaleCatalog(locale)).sort()).toEqual([...NAMESPACES].sort());
    }
  });

  it.each(NON_DEFAULT_LOCALES)("%s has every key the default locale has", (locale) => {
    const missing: string[] = [];
    for (const namespace of NAMESPACES) {
      if (PARTIAL_NAMESPACES.has(namespace) && !FULL_LOCALES_FOR_PARTIAL.has(locale)) continue;
      const actual = flatten(getLocaleCatalog(locale)[namespace]);
      for (const key of flatten(getLocaleCatalog(DEFAULT_LOCALE)[namespace]).keys()) {
        if (!actual.has(key)) missing.push(`${namespace}.${key}`);
      }
    }
    expect(missing, `${locale} is missing ${missing.length} key(s)`).toEqual([]);
  });

  it.each(NON_DEFAULT_LOCALES)("%s has no orphan keys the default locale lacks", (locale) => {
    const orphans: string[] = [];
    for (const namespace of NAMESPACES) {
      const expected = flatten(getLocaleCatalog(DEFAULT_LOCALE)[namespace]);
      for (const key of flatten(getLocaleCatalog(locale)[namespace]).keys()) {
        if (!expected.has(key)) orphans.push(`${namespace}.${key}`);
      }
    }
    expect(orphans).toEqual([]);
  });

  it("has no empty messages", () => {
    const empty: string[] = [];
    for (const locale of SUPPORTED_LOCALES) {
      for (const namespace of NAMESPACES) {
        for (const [key, value] of flatten(getLocaleCatalog(locale)[namespace])) {
          if (value.trim() === "") empty.push(`${locale}/${namespace}/${key}`);
        }
      }
    }
    expect(empty).toEqual([]);
  });

  it.each(NON_DEFAULT_LOCALES)(
    "%s uses exactly the ICU arguments the default locale uses",
    (locale) => {
      const mismatched: string[] = [];
      for (const namespace of NAMESPACES) {
        const base = flatten(getLocaleCatalog(DEFAULT_LOCALE)[namespace]);
        for (const [key, template] of flatten(getLocaleCatalog(locale)[namespace])) {
          const expected = base.get(key);
          if (expected === undefined) continue;
          const want = [...argumentsOf(expected).keys()].sort().join(",");
          const got = [...argumentsOf(template).keys()].sort().join(",");
          if (want !== got) mismatched.push(`${namespace}.${key}: es{${want}} ${locale}{${got}}`);
        }
      }
      expect(mismatched).toEqual([]);
    },
  );

  it.each(SUPPORTED_LOCALES)(
    "%s renders every message without throwing and without leaking braces",
    (locale) => {
      const broken: string[] = [];
      for (const namespace of NAMESPACES) {
        for (const [key, template] of flatten(getLocaleCatalog(locale)[namespace])) {
          try {
            const rendered = render(namespace, key, template, locale);
            if (rendered.includes("{") || rendered.includes("}")) {
              broken.push(`${namespace}.${key} leaks a brace`);
            }
          } catch (error) {
            broken.push(`${namespace}.${key}: ${(error as Error).message}`);
          }
        }
      }
      expect(broken).toEqual([]);
    },
  );

  it("keeps plural-bearing messages correct in each language's own categories", () => {
    // Polish/Russian 'few' (2-4) vs 'many' (5+) — a two-branch
    // English-shaped translation would render identically for 3 and 5.
    for (const locale of ["pl", "ru", "uk"] as const) {
      const template = flatten(getNamespaceMessages(locale, "jobs")).get("count")!;
      const t = createTranslator({ locale, messages: { jobs: { count: template } } });
      expect(t("jobs.count" as never, { count: 3 } as never), locale).not.toBe(
        t("jobs.count" as never, { count: 5 } as never),
      );
    }
  });
});

describe("fallback merging", () => {
  it("returns the default locale's catalog unchanged", () => {
    expect(getMessages(DEFAULT_LOCALE)).toBe(getLocaleCatalog(DEFAULT_LOCALE));
  });

  it("memoises per locale", () => {
    expect(getMessages("uk")).toBe(getMessages("uk"));
    expect(getMessages("ru")).toBe(getMessages("ru"));
  });

  it("does not mutate the imported JSON while merging", () => {
    const before = JSON.stringify(getLocaleCatalog(DEFAULT_LOCALE).common);
    getMessages("cs");
    getMessages("nl");
    expect(JSON.stringify(getLocaleCatalog(DEFAULT_LOCALE).common)).toBe(before);
  });

  it("falls back key-by-key to Spanish, never to an undefined value", () => {
    // A deliberately partial locale (admin, for non-es/en locales) must
    // still produce a string for every Spanish key after merging.
    for (const locale of SUPPORTED_LOCALES) {
      const merged = getMessages(locale);
      for (const namespace of NAMESPACES) {
        const mergedFlat = flatten(merged[namespace]);
        for (const key of flatten(getLocaleCatalog(DEFAULT_LOCALE)[namespace]).keys()) {
          expect(typeof mergedFlat.get(key), `${locale}/${namespace}.${key}`).toBe("string");
        }
      }
    }
  });

  it("serves the translated value, not the Spanish one, when a locale has the key", () => {
    expect(getNamespaceMessages("ru", "nav").login).toBe("Войти");
    expect(getNamespaceMessages("nl", "nav").login).toBe("Inloggen");
    expect(getNamespaceMessages("es", "nav").login).toBe("Iniciar sesión");
  });
});

describe("client message selection", () => {
  it("never ships server-only namespaces to the browser", () => {
    const client = selectClientMessages(getMessages("ru"), { includeAdmin: true });
    for (const namespace of SERVER_ONLY_NAMESPACES) expect(client).not.toHaveProperty(namespace);
  });

  it("ships the admin namespace only to admins", () => {
    expect(selectClientMessages(getMessages("nl"), { includeAdmin: false })).not.toHaveProperty(
      "admin",
    );
    expect(selectClientMessages(getMessages("nl"), { includeAdmin: true })).toHaveProperty("admin");
  });
});
