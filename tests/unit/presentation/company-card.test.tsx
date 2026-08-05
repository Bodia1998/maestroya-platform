import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { CompanyCard } from "@/components/dashboard/cards/company-card";

describe("CompanyCard", () => {
  it("renders the company name, status badge, and links to the given href", () => {
    render(<CompanyCard href="/dashboard/companies/company-1" name="Acme Contracting" status="ACTIVE" />);

    expect(screen.getByText("Acme Contracting")).toBeTruthy();
    expect(screen.getByText("Active")).toBeTruthy();

    const link = screen.getByRole("link");
    expect(link.getAttribute("href")).toBe("/dashboard/companies/company-1");
  });

  it("defaults the action label to Manage", () => {
    render(<CompanyCard href="/dashboard/companies/company-1" name="Acme Contracting" status="ACTIVE" />);
    expect(screen.getByText("Manage")).toBeTruthy();
  });

  it("renders a custom action label when provided", () => {
    render(<CompanyCard href="/dashboard/companies/company-1" name="Acme Contracting" status="ACTIVE" actionLabel="View" />);
    expect(screen.getByText("View")).toBeTruthy();
    expect(screen.queryByText("Manage")).toBeNull();
  });
});
