import { DEFAULT_LOCALE } from "@/shared/i18n/locales";

/**
 * Module 29 — Internationalization: an ICU MessageFormat renderer built
 * on the platform's own `Intl` primitives.
 *
 * ## Why this file exists at all
 *
 * The library decision for this module was `next-intl` (see
 * docs/MODULE_29_INTERNATIONALIZATION.md §2 for the full comparison
 * against react-i18next / next-i18next / Lingui). This module implements
 * the *message-formatting* half of that API surface — the ICU subset the
 * platform actually uses — against `Intl.PluralRules`,
 * `Intl.NumberFormat` and `Intl.DateTimeFormat`, which are built into
 * both Node ≥ 20 and every browser this app supports.
 *
 * The syntax accepted here is deliberately a strict subset of real ICU
 * MessageFormat, so every message file in `src/i18n/messages` is valid
 * input to `next-intl`/`intl-messageformat` unchanged. That is the point:
 * swapping this renderer for the library is a change to
 * `translator.ts`/`i18n-provider.tsx` only, never to the 120 translation
 * files or to any calling component. See §10, "Known limitations".
 *
 * ## Supported syntax
 *
 * - `{name}` — plain interpolation.
 * - `{n, number}` / `{n, number, percent}` — `Intl.NumberFormat`.
 * - `{d, date}` / `{d, date, short|medium|long|full}` — `Intl.DateTimeFormat`.
 * - `{d, time}` / `{d, time, short|medium}` — ditto, time-only.
 * - `{n, plural, =0 {…} one {…} few {…} many {…} other {…}}` — CLDR
 *   plural categories via `Intl.PluralRules`, with `#` inside a branch
 *   rendering the (locale-formatted) number. Exact `=N` matches win over
 *   category matches, exactly as in ICU.
 * - `{v, select, a {…} other {…}}` — string select.
 * - Arbitrary nesting of the above inside branch bodies.
 *
 * ## Not supported (deliberate, documented)
 *
 * - ICU apostrophe escaping (`'{'`), `offset:` on plurals, `selectordinal`,
 *   `{n, number, ::currency/EUR}` skeletons, and rich-text/tag embedding.
 *   None of them are used by this platform's messages; a unit test
 *   asserts that every shipped message renders, so an author who reaches
 *   for one of them finds out at test time rather than in production.
 */

export type MessageValue = string | number | boolean | Date | null | undefined;
export type MessageValues = Record<string, MessageValue>;

interface RenderContext {
  locale: string;
  values: MessageValues;
  /** The active `{n, plural, …}` argument value, for `#` substitution. */
  pluralValue?: number;
}

/**
 * `Intl.*` constructors are comparatively expensive and this renderer is
 * called once per translated string per render. One cache per formatter
 * kind, keyed by locale + options — the standard memoization every i18n
 * library does internally.
 */
const numberFormatters = new Map<string, Intl.NumberFormat>();
const dateFormatters = new Map<string, Intl.DateTimeFormat>();
const pluralRules = new Map<string, Intl.PluralRules>();

function getNumberFormat(locale: string, options: Intl.NumberFormatOptions): Intl.NumberFormat {
  const key = `${locale}|${JSON.stringify(options)}`;
  let formatter = numberFormatters.get(key);
  if (!formatter) {
    formatter = new Intl.NumberFormat(locale, options);
    numberFormatters.set(key, formatter);
  }
  return formatter;
}

function getDateFormat(locale: string, options: Intl.DateTimeFormatOptions): Intl.DateTimeFormat {
  const key = `${locale}|${JSON.stringify(options)}`;
  let formatter = dateFormatters.get(key);
  if (!formatter) {
    formatter = new Intl.DateTimeFormat(locale, options);
    dateFormatters.set(key, formatter);
  }
  return formatter;
}

function getPluralRules(locale: string): Intl.PluralRules {
  let rules = pluralRules.get(locale);
  if (!rules) {
    rules = new Intl.PluralRules(locale);
    pluralRules.set(locale, rules);
  }
  return rules;
}

const DATE_STYLES: Record<string, Intl.DateTimeFormatOptions> = {
  short: { dateStyle: "short" },
  medium: { dateStyle: "medium" },
  long: { dateStyle: "long" },
  full: { dateStyle: "full" },
};

const TIME_STYLES: Record<string, Intl.DateTimeFormatOptions> = {
  short: { timeStyle: "short" },
  medium: { timeStyle: "medium" },
  long: { timeStyle: "long" },
};

/** Index of the `}` matching the `{` at `openIndex`, or -1 if unbalanced. */
function findMatchingBrace(source: string, openIndex: number): number {
  let depth = 0;
  for (let i = openIndex; i < source.length; i++) {
    const ch = source[i];
    if (ch === "{") depth++;
    else if (ch === "}") {
      depth--;
      if (depth === 0) return i;
    }
  }
  return -1;
}

/** Split on commas that sit at brace-depth 0, at most `limit` times. */
function splitTopLevel(source: string, limit: number): string[] {
  const parts: string[] = [];
  let depth = 0;
  let start = 0;
  for (let i = 0; i < source.length; i++) {
    const ch = source[i];
    if (ch === "{") depth++;
    else if (ch === "}") depth--;
    else if (ch === "," && depth === 0 && parts.length < limit) {
      parts.push(source.slice(start, i));
      start = i + 1;
    }
  }
  parts.push(source.slice(start));
  return parts;
}

/**
 * Parse `key {body} key2 {body2}` option lists used by `plural`/`select`.
 * Preserves author order so `other` can appear anywhere.
 */
function parseOptions(source: string): Array<{ key: string; body: string }> {
  const options: Array<{ key: string; body: string }> = [];
  let i = 0;
  while (i < source.length) {
    while (i < source.length && /\s/.test(source[i] ?? "")) i++;
    const keyStart = i;
    while (i < source.length && !/\s/.test(source[i] ?? "") && source[i] !== "{") i++;
    const key = source.slice(keyStart, i).trim();
    while (i < source.length && /\s/.test(source[i] ?? "")) i++;
    if (source[i] !== "{") break;
    const close = findMatchingBrace(source, i);
    if (close === -1) break;
    options.push({ key, body: source.slice(i + 1, close) });
    i = close + 1;
  }
  return options;
}

function pickOption(
  options: Array<{ key: string; body: string }>,
  candidates: string[],
): string | null {
  for (const candidate of candidates) {
    const match = options.find((option) => option.key === candidate);
    if (match) return match.body;
  }
  return null;
}

function toNumber(value: MessageValue): number {
  if (typeof value === "number") return value;
  if (typeof value === "string" && value.trim() !== "") {
    const parsed = Number(value);
    if (!Number.isNaN(parsed)) return parsed;
  }
  return Number.NaN;
}

function toDate(value: MessageValue): Date | null {
  if (value instanceof Date) return value;
  if (typeof value === "number" || typeof value === "string") {
    const parsed = new Date(value);
    if (!Number.isNaN(parsed.getTime())) return parsed;
  }
  return null;
}

function stringifyPlain(value: MessageValue): string {
  if (value === null || value === undefined) return "";
  if (value instanceof Date) return value.toISOString();
  return String(value);
}

function renderArgument(body: string, ctx: RenderContext): string {
  const [rawName = "", rawType, rawRest] = splitTopLevel(body, 2);
  const name = rawName.trim();
  const value = ctx.values[name];

  if (rawType === undefined) return stringifyPlain(value);

  const type = rawType.trim();
  const rest = (rawRest ?? "").trim();

  switch (type) {
    case "number": {
      const numeric = toNumber(value);
      if (Number.isNaN(numeric)) return stringifyPlain(value);
      const options: Intl.NumberFormatOptions =
        rest === "percent"
          ? { style: "percent" }
          : rest === "integer"
            ? { maximumFractionDigits: 0 }
            : {};
      return getNumberFormat(ctx.locale, options).format(numeric);
    }
    case "date": {
      const date = toDate(value);
      if (!date) return stringifyPlain(value);
      return getDateFormat(ctx.locale, DATE_STYLES[rest] ?? DATE_STYLES.medium!).format(date);
    }
    case "time": {
      const date = toDate(value);
      if (!date) return stringifyPlain(value);
      return getDateFormat(ctx.locale, TIME_STYLES[rest] ?? TIME_STYLES.short!).format(date);
    }
    case "plural": {
      const numeric = toNumber(value);
      const options = parseOptions(rest);
      if (Number.isNaN(numeric)) {
        const fallback = pickOption(options, ["other"]);
        return fallback === null ? "" : renderRange(fallback, ctx);
      }
      const category = getPluralRules(ctx.locale).select(numeric);
      const chosen = pickOption(options, [`=${numeric}`, category, "other"]);
      if (chosen === null) return "";
      return renderRange(chosen, { ...ctx, pluralValue: numeric });
    }
    case "select": {
      const options = parseOptions(rest);
      const chosen = pickOption(options, [stringifyPlain(value), "other"]);
      if (chosen === null) return "";
      return renderRange(chosen, ctx);
    }
    default:
      // Unknown argument type: render the raw value rather than throwing.
      // A message file is content, and content should never be able to
      // crash a page render — the completeness test is what catches
      // authoring mistakes.
      return stringifyPlain(value);
  }
}

function renderRange(source: string, ctx: RenderContext): string {
  let out = "";
  let i = 0;
  while (i < source.length) {
    const ch = source[i]!;
    if (ch === "#" && ctx.pluralValue !== undefined) {
      out += getNumberFormat(ctx.locale, {}).format(ctx.pluralValue);
      i++;
      continue;
    }
    if (ch !== "{") {
      out += ch;
      i++;
      continue;
    }
    const close = findMatchingBrace(source, i);
    if (close === -1) {
      out += ch;
      i++;
      continue;
    }
    out += renderArgument(source.slice(i + 1, close), ctx);
    i = close + 1;
  }
  return out;
}

/**
 * Render one ICU message template.
 *
 * Never throws on bad input: an unbalanced brace, an unknown argument
 * type, or a missing value degrades to the most literal reasonable
 * output. Translation files are content — a translator's typo must not
 * be able to take down a page.
 */
export function formatMessage(
  template: string,
  values: MessageValues = {},
  locale: string = DEFAULT_LOCALE,
): string {
  if (!template.includes("{") && !template.includes("#")) return template;
  return renderRange(template, { locale, values });
}
