import { DEFAULT_LOCALE, type Locale } from "@/shared/i18n/locales";

/**
 * Module 29 — Internationalization: locale-aware **display** formatting.
 *
 * Everything here is presentation-only and built on the runtime's own
 * `Intl` implementation — there is no formatting table, no hardcoded
 * `dd/MM/yyyy`, no `"€" + amount`, and no dependency on any date library.
 * A new language gets correct dates, numbers and currency for free the
 * moment its code is added to `SUPPORTED_LOCALES`.
 *
 * ## Scope boundary — payments
 *
 * `formatCurrency` **formats**. It does not compute, convert, round for
 * settlement, apply IVA/VAT, or touch Stripe in any way. Module 22
 * (Commission & Financial) and the Stripe integration own all of that and
 * are untouched by this module. The one concession to the future is
 * `formatCurrencyFromMinorUnits`, which exists because Stripe amounts
 * arrive as integer minor units (cents) and every call site that will
 * eventually render one should already be converting through a single
 * audited helper rather than each inventing its own `/ 100`. It derives
 * the exponent from `Intl` (`maximumFractionDigits` for the currency), so
 * it is already correct for zero-decimal currencies (JPY) and
 * three-decimal ones (BHD) without a hardcoded table.
 */

/** MaestroYa is a Spain-only marketplace today; EUR is the only currency in use. */
export const DEFAULT_CURRENCY = "EUR";

export type DateStyle = "short" | "medium" | "long" | "full";
export type TimeStyle = "short" | "medium";

const numberFormatters = new Map<string, Intl.NumberFormat>();
const dateFormatters = new Map<string, Intl.DateTimeFormat>();
const relativeFormatters = new Map<string, Intl.RelativeTimeFormat>();

function numberFormat(locale: string, options: Intl.NumberFormatOptions): Intl.NumberFormat {
  const key = `${locale}|${JSON.stringify(options)}`;
  let formatter = numberFormatters.get(key);
  if (!formatter) {
    formatter = new Intl.NumberFormat(locale, options);
    numberFormatters.set(key, formatter);
  }
  return formatter;
}

function dateFormat(locale: string, options: Intl.DateTimeFormatOptions): Intl.DateTimeFormat {
  const key = `${locale}|${JSON.stringify(options)}`;
  let formatter = dateFormatters.get(key);
  if (!formatter) {
    formatter = new Intl.DateTimeFormat(locale, options);
    dateFormatters.set(key, formatter);
  }
  return formatter;
}

function relativeFormat(locale: string): Intl.RelativeTimeFormat {
  let formatter = relativeFormatters.get(locale);
  if (!formatter) {
    formatter = new Intl.RelativeTimeFormat(locale, { numeric: "auto" });
    relativeFormatters.set(locale, formatter);
  }
  return formatter;
}

/**
 * Descending so the first unit whose threshold the delta clears wins —
 * "3 days ago" beats "72 hours ago". `year`/`month` use the conventional
 * average lengths; this is a human-readable approximation by design, not
 * a calendar calculation.
 */
const RELATIVE_UNITS: Array<{ unit: Intl.RelativeTimeFormatUnit; ms: number }> = [
  { unit: "year", ms: 1000 * 60 * 60 * 24 * 365 },
  { unit: "month", ms: 1000 * 60 * 60 * 24 * 30 },
  { unit: "week", ms: 1000 * 60 * 60 * 24 * 7 },
  { unit: "day", ms: 1000 * 60 * 60 * 24 },
  { unit: "hour", ms: 1000 * 60 * 60 },
  { unit: "minute", ms: 1000 * 60 },
  { unit: "second", ms: 1000 },
];

export interface LocaleFormatter {
  locale: Locale;
  date(value: Date | string | number, style?: DateStyle): string;
  time(value: Date | string | number, style?: TimeStyle): string;
  dateTime(value: Date | string | number, dateStyle?: DateStyle, timeStyle?: TimeStyle): string;
  number(value: number, options?: Intl.NumberFormatOptions): string;
  percent(value: number, options?: Intl.NumberFormatOptions): string;
  /** `amount` is a **major-unit** value (12.5 = twelve euros fifty). */
  currency(amount: number, currency?: string, options?: Intl.NumberFormatOptions): string;
  /** `amount` is an **integer minor-unit** value (1250 = twelve euros fifty). */
  currencyFromMinorUnits(amount: number, currency?: string): string;
  relativeTime(value: Date | string | number, now?: Date): string;
  list(items: string[], type?: "conjunction" | "disjunction"): string;
}

function coerceDate(value: Date | string | number): Date | null {
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

/**
 * Number of decimal places a currency uses, per `Intl`. Cached through
 * the same `numberFormat` map — `resolvedOptions()` is cheap once the
 * formatter exists.
 */
export function currencyFractionDigits(locale: string, currency: string): number {
  // `maximumFractionDigits` is optional in the TS lib types even though a
  // currency-style formatter always resolves one. `2` is the correct
  // fallback for the overwhelming majority of ISO 4217 currencies
  // (including EUR, the only one in use here) and, more to the point, is
  // never reached on any runtime that implements ECMA-402.
  return (
    numberFormat(locale, { style: "currency", currency }).resolvedOptions().maximumFractionDigits ??
    2
  );
}

/**
 * Build every formatter for one locale. Returned as a small object rather
 * than a set of free functions so a component destructures once
 * (`const { date, currency } = useFormatter()`) instead of threading the
 * locale through every call.
 */
export function createLocaleFormatter(locale: Locale = DEFAULT_LOCALE): LocaleFormatter {
  return {
    locale,

    date(value, style = "medium") {
      const date = coerceDate(value);
      return date ? dateFormat(locale, { dateStyle: style }).format(date) : "";
    },

    time(value, style = "short") {
      const date = coerceDate(value);
      return date ? dateFormat(locale, { timeStyle: style }).format(date) : "";
    },

    dateTime(value, dateStyle = "medium", timeStyle = "short") {
      const date = coerceDate(value);
      return date ? dateFormat(locale, { dateStyle, timeStyle }).format(date) : "";
    },

    number(value, options) {
      if (!Number.isFinite(value)) return "";
      return numberFormat(locale, options ?? {}).format(value);
    },

    percent(value, options) {
      if (!Number.isFinite(value)) return "";
      return numberFormat(locale, { style: "percent", ...options }).format(value);
    },

    currency(amount, currency = DEFAULT_CURRENCY, options) {
      if (!Number.isFinite(amount)) return "";
      return numberFormat(locale, { style: "currency", currency, ...options }).format(amount);
    },

    currencyFromMinorUnits(amount, currency = DEFAULT_CURRENCY) {
      if (!Number.isFinite(amount)) return "";
      const digits = currencyFractionDigits(locale, currency);
      return numberFormat(locale, { style: "currency", currency }).format(amount / 10 ** digits);
    },

    relativeTime(value, now = new Date()) {
      const date = coerceDate(value);
      if (!date) return "";
      const deltaMs = date.getTime() - now.getTime();
      const absMs = Math.abs(deltaMs);

      for (const { unit, ms } of RELATIVE_UNITS) {
        if (absMs >= ms) {
          return relativeFormat(locale).format(Math.round(deltaMs / ms), unit);
        }
      }
      // Under a second in either direction — "now", localised.
      return relativeFormat(locale).format(0, "second");
    },

    list(items, type = "conjunction") {
      return new Intl.ListFormat(locale, { style: "long", type }).format(items);
    },
  };
}
