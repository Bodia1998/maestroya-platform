import "@testing-library/jest-dom/vitest";

import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { CompanyTabNav } from "../../../src/app/(dashboard)/dashboard/company/[companyId]/company-tab-nav";

/**
 * Module 30.6 — Profile & Settings UX: `CompanyTabNav` was extracted from a
 * one-off nav that previously only rendered on the company Profile page,
 * leaving Members / Invitations / Verification with no way back to the
 * others. This covers: all four links render with the right hrefs,
 * `aria-current="page"` is set on (and only on) the active tab, and the
 * active/inactive tabs get visually distinct styling.
 */
describe("CompanyTabNav", () => {
  it("renders all four company section links with the correct hrefs", () => {
    render(<CompanyTabNav companyId="company-1" active="profile" />);

    expect(screen.getByRole("link", { name: "Profile" })).toHaveAttribute(
      "href",
      "/dashboard/company/company-1/profile",
    );
    expect(screen.getByRole("link", { name: "Members" })).toHaveAttribute(
      "href",
      "/dashboard/company/company-1/members",
    );
    expect(screen.getByRole("link", { name: "Invitations" })).toHaveAttribute(
      "href",
      "/dashboard/company/company-1/invitations",
    );
    expect(screen.getByRole("link", { name: "Verification" })).toHaveAttribute(
      "href",
      "/dashboard/company/company-1/verification",
    );
  });

  it("marks only the active tab with aria-current, and none of the others", () => {
    render(<CompanyTabNav companyId="company-1" active="members" />);

    expect(screen.getByRole("link", { name: "Members" })).toHaveAttribute("aria-current", "page");
    expect(screen.getByRole("link", { name: "Profile" })).not.toHaveAttribute("aria-current");
    expect(screen.getByRole("link", { name: "Invitations" })).not.toHaveAttribute("aria-current");
    expect(screen.getByRole("link", { name: "Verification" })).not.toHaveAttribute("aria-current");
  });

  it("applies distinct styling to the active tab vs. inactive tabs", () => {
    render(<CompanyTabNav companyId="company-1" active="verification" />);

    const active = screen.getByRole("link", { name: "Verification" });
    const inactive = screen.getByRole("link", { name: "Profile" });

    expect(active.className).toContain("border-primary");
    expect(inactive.className).not.toContain("border-primary");
    expect(inactive.className).toContain("border-transparent");
  });

  it("exposes an accessible nav label for screen readers", () => {
    render(<CompanyTabNav companyId="company-1" active="profile" />);
    expect(screen.getByRole("navigation", { name: "Company sections" })).toBeTruthy();
  });
});
