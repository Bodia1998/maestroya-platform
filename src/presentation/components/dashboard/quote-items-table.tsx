import { useFormatter, useTranslations } from "next-intl";

/**
 * Quotes module — shared read-only line-item table, replacing two
 * hand-duplicated `<table>` markups that rendered the same
 * description/quantity/unit price/amount shape with different columns and
 * no total row:
 *   - (dashboard)/dashboard/professional/quotes/[id]/page.tsx (the
 *     professional's own quote detail)
 *   - (dashboard)/requests/[id]/quotes/page.tsx (the customer's view of
 *     quotes received on their request)
 *
 * Presentation-only — `amount`/`totalAmount` are always the server-computed
 * values from `domain/services/money.ts`; this component never recomputes
 * them, it only formats and lays them out.
 */
export interface QuoteItemRow {
  id: string;
  description: string;
  category: string;
  quantity: number;
  unitPrice: number;
  amount: number;
}

export interface QuoteItemsTableProps {
  items: readonly QuoteItemRow[];
  currency: string;
  /** Renders a "Total" row below the items, using the server-computed total rather than re-summing client-side. */
  totalAmount?: number;
  className?: string;
}

/**
 * `12.5` + `"EUR"` → `"EUR 12.50"` — the exact format every quote page
 * already rendered inline, just centralized. `amount` is a *major-unit*
 * decimal (Decimal(10,2) columns converted at the repository boundary).
 *
 * Module 120 — Multilingual Localization: pass the active `locale` to get
 * locale-aware currency formatting (`"12,50 €"` in `es`, `"€12.50"` in
 * `en`). Without it the legacy, locale-independent format is kept for
 * callers not yet migrated.
 */
export function formatMoney(amount: number, currency: string, locale?: string): string {
  if (locale) {
    return new Intl.NumberFormat(locale, { style: "currency", currency }).format(amount);
  }
  return `${currency} ${amount.toFixed(2)}`;
}

export function QuoteItemsTable({ items, currency, totalAmount, className }: QuoteItemsTableProps) {
  const t = useTranslations("jobs.quoteItems");
  const format = useFormatter();
  /** `"MATERIALS"` / `"LABOR"` → a localized label — falls back to the raw value for forward-compatibility with a category this component doesn't know about yet. */
  const categoryLabel = (category: string): string =>
    t.has(`category.${category}` as never) ? t(`category.${category}` as never) : category;
  const money = (amount: number) => format.number(amount, { style: "currency", currency });
  return (
    <table className={className ? `w-full text-sm ${className}` : "w-full text-sm"}>
      <thead>
        <tr className="border-b border-border text-left text-foreground/60">
          <th className="py-2">{t("columns.description")}</th>
          <th className="py-2">{t("columns.type")}</th>
          <th className="py-2">{t("columns.quantity")}</th>
          <th className="py-2">{t("columns.unitPrice")}</th>
          <th className="py-2 text-right">{t("columns.amount")}</th>
        </tr>
      </thead>
      <tbody>
        {items.map((item) => (
          <tr key={item.id} className="border-b border-border/50">
            <td className="py-2">{item.description}</td>
            <td className="py-2">
              <span className="rounded-full bg-black/5 px-2 py-0.5 text-xs font-medium text-foreground/70">
                {categoryLabel(item.category)}
              </span>
            </td>
            <td className="py-2">{format.number(item.quantity)}</td>
            <td className="py-2">{money(item.unitPrice)}</td>
            <td className="py-2 text-right">{money(item.amount)}</td>
          </tr>
        ))}
      </tbody>
      {totalAmount !== undefined && (
        <tfoot>
          <tr>
            <td className="pt-3" colSpan={4}>
              <span className="text-sm font-medium text-foreground">{t("total")}</span>
            </td>
            <td className="pt-3 text-right">
              <span className="text-sm font-semibold text-foreground">{money(totalAmount)}</span>
            </td>
          </tr>
        </tfoot>
      )}
    </table>
  );
}
