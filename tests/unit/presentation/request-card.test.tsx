import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { RequestCard } from "@/components/dashboard/cards/request-card";

describe("RequestCard", () => {
  it("renders the title, status badge, and links to the given href", () => {
    render(<RequestCard href="/dashboard/requests/req-1" title="Leaky faucet repair" status="PUBLISHED" />);

    expect(screen.getByRole("heading", { name: "Leaky faucet repair" })).toBeTruthy();
    expect(screen.getByText("Open")).toBeTruthy();

    const link = screen.getByRole("link");
    expect(link.getAttribute("href")).toBe("/dashboard/requests/req-1");
  });

  it("renders category and city when provided", () => {
    render(
      <RequestCard
        href="/dashboard/requests/req-1"
        title="Leaky faucet repair"
        status="PUBLISHED"
        categoryName="Plumbing"
        city="Madrid"
      />,
    );
    expect(screen.getByText("Plumbing")).toBeTruthy();
    expect(screen.getByText("Madrid")).toBeTruthy();
  });

  it("omits category, city, and dates when not provided", () => {
    render(<RequestCard href="/dashboard/requests/req-1" title="Leaky faucet repair" status="PUBLISHED" />);
    expect(screen.queryByText("Plumbing")).toBeNull();
    expect(screen.queryByText(/^Posted/)).toBeNull();
  });

  it("renders posted/updated dates only when both are provided", () => {
    render(
      <RequestCard
        href="/dashboard/requests/req-1"
        title="Leaky faucet repair"
        status="PUBLISHED"
        createdAt={new Date("2026-01-01")}
        updatedAt={new Date("2026-01-05")}
      />,
    );
    expect(screen.getByText(/^Posted/)).toBeTruthy();
  });
});
