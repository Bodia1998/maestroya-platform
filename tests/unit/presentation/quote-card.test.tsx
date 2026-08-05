import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { QuoteCard } from "@/components/dashboard/cards/quote-card";

describe("QuoteCard", () => {
  it("renders the title, status badge, and links to the given href", () => {
    render(<QuoteCard href="/dashboard/professional/quotes/quote-1" title="Quote for faucet repair" status="SENT" />);

    expect(screen.getByRole("heading", { name: "Quote for faucet repair" })).toBeTruthy();
    expect(screen.getByText("Sent")).toBeTruthy();

    const link = screen.getByRole("link");
    expect(link.getAttribute("href")).toBe("/dashboard/professional/quotes/quote-1");
  });

  it("renders category and amount when provided", () => {
    render(
      <QuoteCard
        href="/dashboard/professional/quotes/quote-1"
        title="Quote for faucet repair"
        status="SENT"
        categoryName="Plumbing"
        amountLabel="€120.00"
      />,
    );
    expect(screen.getByText("Plumbing")).toBeTruthy();
    expect(screen.getByText("€120.00")).toBeTruthy();
  });

  it("renders submitted/updated dates only when both are provided", () => {
    render(
      <QuoteCard
        href="/dashboard/professional/quotes/quote-1"
        title="Quote for faucet repair"
        status="SENT"
        createdAt={new Date("2026-01-01")}
        updatedAt={new Date("2026-01-05")}
      />,
    );
    expect(screen.getByText(/^Submitted/)).toBeTruthy();
  });

  it("omits category, amount, and dates when not provided", () => {
    render(<QuoteCard href="/dashboard/professional/quotes/quote-1" title="Quote for faucet repair" status="SENT" />);
    expect(screen.queryByText(/^Submitted/)).toBeNull();
  });
});
