import "@testing-library/jest-dom/vitest";

import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { setTestLocale } from "../../test-utils/intl";

/**
 * Module 120 — the company and partner dashboard components render their
 * catalog text (`company.*`, `partner.*`) in the active UI locale, with
 * ICU plurals resolved per locale.
 */
vi.mock("../../../src/app/(dashboard)/dashboard/partner/actions", () => ({
  createReferralLinkAction: vi.fn(),
  setReferralLinkActiveAction: vi.fn(),
}));

const { CompanyTabNav } = await import("../../../src/app/(dashboard)/dashboard/company/[companyId]/company-tab-nav");
const { CampaignManager } = await import("../../../src/app/(dashboard)/dashboard/partner/campaign-manager");

describe("company/partner dashboard localisation", () => {
  it("renders the company section tabs in Russian", () => {
    setTestLocale("ru");
    render(<CompanyTabNav companyId="company-1" active="members" />);

    expect(screen.getByRole("navigation", { name: "Разделы компании" })).toBeTruthy();
    expect(screen.getByRole("link", { name: "Участники" })).toHaveAttribute("aria-current", "page");
    expect(screen.getByRole("link", { name: "Самовыставление счетов" })).toHaveAttribute(
      "href",
      "/dashboard/company/company-1/self-billing",
    );
    expect(screen.queryByRole("link", { name: "Members" })).toBeNull();
  });

  it("renders the partner campaign manager in Dutch, with plural visit counts", () => {
    setTestLocale("nl");
    render(
      <CampaignManager
        initialLinks={[
          { id: "l1", code: "telegram_valencia", label: null, source: "TELEGRAM", isActive: true, visits: 1 },
          { id: "l2", code: "blog_madrid", label: null, source: "WEBSITE", isActive: false, visits: 3 },
        ]}
      />,
    );

    expect(screen.getByText("Campagnelinks")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Link aanmaken" })).toBeTruthy();
    expect(screen.getByText("1 bezoek")).toBeTruthy();
    expect(screen.getByText("3 bezoeken")).toBeTruthy();
    expect(screen.getByText("Actief")).toBeTruthy();
    expect(screen.getByText("Inactief")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Deactiveren" })).toBeTruthy();
    expect(screen.getAllByText("Website").length).toBeGreaterThan(0);
  });
});
