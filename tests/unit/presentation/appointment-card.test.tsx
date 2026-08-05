import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { AppointmentCard } from "@/components/dashboard/cards/appointment-card";

describe("AppointmentCard", () => {
  it("renders the title, status badge, and links to the given href", () => {
    render(<AppointmentCard href="/dashboard/appointments/appt-1" title="Kitchen sink install" status="CONFIRMED" />);

    expect(screen.getByRole("heading", { name: "Kitchen sink install" })).toBeTruthy();
    expect(screen.getByText("Confirmed")).toBeTruthy();

    const link = screen.getByRole("link");
    expect(link.getAttribute("href")).toBe("/dashboard/appointments/appt-1");
  });

  it("renders the counterparty name and window when provided", () => {
    render(
      <AppointmentCard
        href="/dashboard/appointments/appt-1"
        title="Kitchen sink install"
        status="CONFIRMED"
        counterpartyName="Jane Plumber"
        window="Tomorrow, 9-11am"
      />,
    );
    expect(screen.getByText("with Jane Plumber")).toBeTruthy();
    expect(screen.getByText("Tomorrow, 9-11am")).toBeTruthy();
  });

  it("omits the counterparty line when counterpartyName is null or not provided", () => {
    render(<AppointmentCard href="/dashboard/appointments/appt-1" title="Kitchen sink install" status="CONFIRMED" counterpartyName={null} />);
    expect(screen.queryByText(/^with /)).toBeNull();
  });
});
