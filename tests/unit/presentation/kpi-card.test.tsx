import { render, screen } from "@testing-library/react";
import { Briefcase } from "lucide-react";
import { describe, expect, it } from "vitest";

import { KPICard } from "@/components/dashboard/kpi-card";

describe("KPICard", () => {
  it("renders the label, value, and icon", () => {
    render(<KPICard icon={Briefcase} label="Active requests" value={12} />);
    expect(screen.getByText("Active requests")).toBeTruthy();
    expect(screen.getByText("12")).toBeTruthy();
  });

  it("renders as a static container (no link role) when href is omitted", () => {
    render(<KPICard icon={Briefcase} label="Active requests" value={12} />);
    expect(screen.queryByRole("link")).toBeNull();
  });

  it("renders as a link to the given href when href is provided", () => {
    render(<KPICard icon={Briefcase} label="Active requests" value={12} href="/dashboard/requests" />);
    const link = screen.getByRole("link");
    expect(link.getAttribute("href")).toBe("/dashboard/requests");
  });

  it("renders subtext when provided", () => {
    render(<KPICard icon={Briefcase} label="Quotes" value={3} subtext="3 awaiting your reply" />);
    expect(screen.getByText("3 awaiting your reply")).toBeTruthy();
  });

  it("omits subtext and trend when neither is provided", () => {
    render(<KPICard icon={Briefcase} label="Quotes" value={3} />);
    expect(screen.queryByText(/awaiting/)).toBeNull();
  });

  it("renders a positive trend with a plus sign and up arrow", () => {
    render(<KPICard icon={Briefcase} label="Quotes" value={3} trend={{ value: 5, label: "this week" }} />);
    expect(screen.getByText(/\+5 this week/)).toBeTruthy();
  });

  it("renders a negative trend without a plus sign", () => {
    render(<KPICard icon={Briefcase} label="Quotes" value={3} trend={{ value: -2 }} />);
    expect(screen.getByText("-2")).toBeTruthy();
  });

  it("renders a zero trend without a sign", () => {
    render(<KPICard icon={Briefcase} label="Quotes" value={3} trend={{ value: 0 }} />);
    expect(screen.getByText("0")).toBeTruthy();
  });
});
