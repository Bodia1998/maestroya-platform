/**
 * Module 29 — Internationalization: the one piece of locale-aware
 * formatting next-intl's `useFormatter`/`getFormatter` does not cover.
 *
 * Everything general-purpose (dates, plain numbers, percentages, currency
 * from a major-unit amount, relative time, list joining) is now next-intl's
 * job — `useFormatter()` (Client Components) / `getFormatter()` from
 * `next-intl/server` (Server Components), both backed by the same `Intl`
 * primitives this file used to wrap by hand. Duplicating that here would
 * be exactly the kind of shim this migration removes.
 *
 * What's left is genuinely app-specific: Stripe amounts arrive as integer
 * *minor units* (cents), and `Intl.NumberFormat`'s `style: "currency"`
 * expects a *major-unit* amount. `formatCurrencyFromMinorUnits` is the one
 * audited place that conversion happens, so no call site invents its own
 * `/ 100` (wrong for zero-decimal currencies like JPY or three-decimal
 * ones like BHD).
 *
 * ## Scope boundary — payments
 *
 * This formats. It does not compute, convert, round for settlement, apply
 * IVA/VAT, or touch Stripe in any way — Module 22 (Commission & Financial)
 * and the Stripe integration own all of that and are untouched here.
 */

/** MaestroYa is a Spain-only marketplace today; EUR is the only currency in use. */
export const DEFAULT_CURRENCY = "EUR";

const numberFormatters = new Map<string, Intl.NumberFormat>();

function numberFormat(locale: string, options: Intl.NumberFormatOptions): Intl.NumberFormat {
  const key = `${locale}|${JSON.stringify(options)}`;
  let formatter = numberFormatters.get(key);
  if (!formatter) {
    formatter = new Intl.NumberFormat(locale, options);
    numberFormatters.set(key, formatter);
  }
  return formatter;
}

/**
 * Number of decimal places a currency uses, per `Intl`. `2` is the
 * correct fallback for the overwhelming majority of ISO 4217 currencies
 * (including EUR, the only one in use here) and, more to the point, is
 * never reached on any runtime that implements ECMA-402 — `resolvedOptions()`
 * always returns `maximumFractionDigits` for a currency-style formatter.
 */
export function currencyFractionDigits(locale: string, currency: string): number {
  return (
    numberFormat(locale, { style: "currency", currency }).resolvedOptions().maximumFractionDigits ??
    2
  );
}

/** `amountMinorUnits` is an **integer minor-unit** value (1250 = twelve euros fifty). */
export function formatCurrencyFromMinorUnits(
  locale: string,
  amountMinorUnits: number,
  currency: string = DEFAULT_CURRENCY,
): string {
  if (!Number.isFinite(amountMinorUnits)) return "";
  const digits = currencyFractionDigits(locale, currency);
  return numberFormat(locale, { style: "currency", currency }).format(
    amountMinorUnits / 10 ** digits,
  );
}
