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

/** `"MATERIALS"` / `"LABOR"` (or any other future category) → a human label — falls back to the raw value for forward-compatibility with a category this component doesn't know about yet. */
function categoryLabel(category: string): string {
  if (category === "MATERIALS") return "Materials";
  if (category === "LABOR") return "Labor";
  return category;
}

/** `12.5` + `"EUR"` → `"EUR 12.50"` — the exact format every quote page already rendered inline, just centralized. */
export function formatMoney(amount: number, currency: string): string {
  return `${currency} ${amount.toFixed(2)}`;
}

export function QuoteItemsTable({ items, currency, totalAmount, className }: QuoteItemsTableProps) {
  return (
    <table className={className ? `w-full text-sm ${className}` : "w-full text-sm"}>
      <thead>
        <tr className="border-b border-border text-left text-foreground/60">
          <th className="py-2">Description</th>
          <th className="py-2">Type</th>
          <th className="py-2">Qty</th>
          <th className="py-2">Unit price</th>
          <th className="py-2 text-right">Amount</th>
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
            <td className="py-2">{item.quantity}</td>
            <td className="py-2">{formatMoney(item.unitPrice, currency)}</td>
            <td className="py-2 text-right">{formatMoney(item.amount, currency)}</td>
          </tr>
        ))}
      </tbody>
      {totalAmount !== undefined && (
        <tfoot>
          <tr>
            <td className="pt-3" colSpan={4}>
              <span className="text-sm font-medium text-foreground">Total</span>
            </td>
            <td className="pt-3 text-right">
              <span className="text-sm font-semibold text-foreground">{formatMoney(totalAmount, currency)}</span>
            </td>
          </tr>
        </tfoot>
      )}
    </table>
  );
}
