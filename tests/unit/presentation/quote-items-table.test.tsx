import "@testing-library/jest-dom/vitest";

import { render, screen, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { QuoteItemsTable, formatMoney, type QuoteItemRow } from "@/components/dashboard/quote-items-table";

const ITEMS: QuoteItemRow[] = [
  { id: "1", description: "Replace pipe", category: "MATERIALS", quantity: 2, unitPrice: 10, amount: 20 },
  { id: "2", description: "Labor", category: "LABOR", quantity: 1, unitPrice: 50, amount: 50 },
];

describe("formatMoney", () => {
  it("formats an amount with two decimal places and the currency code", () => {
    expect(formatMoney(12.5, "EUR")).toBe("EUR 12.50");
  });

  it("pads whole numbers to two decimals", () => {
    expect(formatMoney(20, "EUR")).toBe("EUR 20.00");
  });
});

describe("QuoteItemsTable", () => {
  it("renders every item's description", () => {
    render(<QuoteItemsTable items={ITEMS} currency="EUR" />);

    // Row 0 is the header row; data rows follow in item order. Item 2's
    // description ("Labor") intentionally collides with its own category
    // badge label ("Labor" for the LABOR category), so querying by text
    // alone is ambiguous — scope to each row and assert on its specific
    // description cell (column 0) instead.
    const rows = screen.getAllByRole("row");
    const pipeRow = rows[1]!;
    const laborRow = rows[2]!;

    expect(within(pipeRow).getAllByRole("cell")[0]).toHaveTextContent("Replace pipe");
    expect(within(laborRow).getAllByRole("cell")[0]).toHaveTextContent("Labor");
  });

  it("renders a human category label for MATERIALS and LABOR", () => {
    render(<QuoteItemsTable items={ITEMS} currency="EUR" />);

    // Same collision as above, this time asserting on the category cell
    // (column 1) specifically, rather than the description cell.
    const rows = screen.getAllByRole("row");
    const materialsRow = rows[1]!;
    const laborRow = rows[2]!;

    expect(within(materialsRow).getAllByRole("cell")[1]).toHaveTextContent("Materials");
    expect(within(laborRow).getAllByRole("cell")[1]).toHaveTextContent("Labor");
  });

  it("formats each item's unit price and amount with the currency", () => {
    render(<QuoteItemsTable items={ITEMS} currency="EUR" />);
    expect(screen.getByText("EUR 10.00")).toBeTruthy();
    expect(screen.getByText("EUR 20.00")).toBeTruthy();
  });

  it("omits the total row when totalAmount is not provided", () => {
    render(<QuoteItemsTable items={ITEMS} currency="EUR" />);
    expect(screen.queryByText("Total")).toBeNull();
  });

  it("renders a total row when totalAmount is provided", () => {
    render(<QuoteItemsTable items={ITEMS} currency="EUR" totalAmount={70} />);
    expect(screen.getByText("Total")).toBeTruthy();
    expect(screen.getByText("EUR 70.00")).toBeTruthy();
  });

  it("falls back to the raw category value for an unknown category", () => {
    const items: QuoteItemRow[] = [
      { id: "3", description: "Misc", category: "OTHER", quantity: 1, unitPrice: 5, amount: 5 },
    ];
    render(<QuoteItemsTable items={items} currency="EUR" />);
    expect(screen.getByText("OTHER")).toBeTruthy();
  });

  it("renders column headers", () => {
    render(<QuoteItemsTable items={ITEMS} currency="EUR" />);
    expect(screen.getByText("Description")).toBeTruthy();
    expect(screen.getByText("Qty")).toBeTruthy();
    expect(screen.getByText("Unit price")).toBeTruthy();
    expect(screen.getByText("Amount")).toBeTruthy();
  });
});
