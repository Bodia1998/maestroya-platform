import "@testing-library/jest-dom/vitest";

import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { AppointmentCard } from "@/components/dashboard/cards/appointment-card";
import { ProfessionalProfileBanner } from "@/components/dashboard/professional-profile-banner";
import { QuoteItemsTable, formatMoney } from "@/components/dashboard/quote-items-table";
import { StatusTimeline } from "@/components/dashboard/status-timeline";
import { getQuoteTimelineSteps } from "@/components/dashboard/quote-timeline-steps";
import { JobStatusBadge } from "@/app/(dashboard)/jobs/job-status-badge";
import { buildNoProfessionalProfileBanner } from "@/shared/utils/professional-profile-banner";

import { setTestLocale } from "../../test-utils/intl";

/**
 * Module 120 — Multilingual Localization: the customer-area / dashboard
 * components render the active locale's catalog text, not English.
 */
describe("customer area localization", () => {
  it("renders the quote timeline with localized status labels (Russian)", () => {
    setTestLocale("ru");
    render(<StatusTimeline steps={getQuoteTimelineSteps("VIEWED")} />);
    expect(screen.getByText("Отправлен")).toBeTruthy();
    expect(screen.getByText("Просмотрен")).toBeTruthy();
  });

  it("renders the Not started job badge in Russian", () => {
    setTestLocale("ru");
    render(<JobStatusBadge status="CREATED" />);
    expect(screen.getByText("Не начат")).toBeTruthy();
  });

  it("renders the appointment card counterparty line in Dutch", () => {
    setTestLocale("nl");
    render(<AppointmentCard href="/appointments/a1" title="Kraan" status="CONFIRMED" counterpartyName="Jan" />);
    expect(screen.getByText("met Jan")).toBeTruthy();
  });

  it("renders quote item headers, category labels and money in Dutch", () => {
    setTestLocale("nl");
    render(
      <QuoteItemsTable
        items={[{ id: "1", description: "Buis", category: "MATERIALS", quantity: 1, unitPrice: 10, amount: 10 }]}
        currency="EUR"
        totalAmount={10}
      />,
    );
    expect(screen.getByText("Omschrijving")).toBeTruthy();
    expect(screen.getByText("Materialen")).toBeTruthy();
    expect(screen.getByText("Totaal")).toBeTruthy();
    // Locale-aware currency ("€ 10,00" in Dutch; Intl uses a no-break space).
    expect(document.body.textContent).toContain(formatMoney(10, "EUR", "nl"));
  });

  it("renders the professional profile banner in Russian", () => {
    setTestLocale("ru");
    render(<ProfessionalProfileBanner info={buildNoProfessionalProfileBanner()} />);
    expect(screen.getByRole("link", { name: "Заполнить профиль специалиста" })).toBeTruthy();
  });

  it("formats money with the given locale", () => {
    expect(formatMoney(12.5, "EUR", "es")).toBe(new Intl.NumberFormat("es", { style: "currency", currency: "EUR" }).format(12.5));
  });
});
