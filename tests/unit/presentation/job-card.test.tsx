import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { JobCard } from "@/components/dashboard/cards/job-card";

describe("JobCard", () => {
  it("renders the title, status badge, and links to the given href", () => {
    render(<JobCard href="/dashboard/jobs/job-1" title="Bathroom remodel" status="IN_PROGRESS" />);

    expect(screen.getByRole("heading", { name: "Bathroom remodel" })).toBeTruthy();
    expect(screen.getByText("In progress")).toBeTruthy();

    const link = screen.getByRole("link");
    expect(link.getAttribute("href")).toBe("/dashboard/jobs/job-1");
  });

  it("renders the counterparty name when provided", () => {
    render(<JobCard href="/dashboard/jobs/job-1" title="Bathroom remodel" status="IN_PROGRESS" counterpartyName="Acme Contracting" />);
    expect(screen.getByText("with Acme Contracting")).toBeTruthy();
  });

  it("omits the counterparty line when not provided", () => {
    render(<JobCard href="/dashboard/jobs/job-1" title="Bathroom remodel" status="IN_PROGRESS" />);
    expect(screen.queryByText(/^with /)).toBeNull();
  });
});
