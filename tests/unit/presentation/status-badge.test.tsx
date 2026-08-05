import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { StatusBadge } from "@/components/dashboard/status-badge";

describe("StatusBadge", () => {
  it.each([
    ["DRAFT", "Draft"],
    ["PUBLISHED", "Open"],
    ["QUOTED", "Quoted"],
    ["ACCEPTED", "Accepted"],
    ["IN_PROGRESS", "In progress"],
    ["COMPLETED", "Completed"],
    ["CANCELLED", "Cancelled"],
    ["EXPIRED", "Expired"],
    ["DISPUTED", "Disputed"],
    ["PENDING", "Pending"],
    ["SENT", "Sent"],
    ["VIEWED", "Viewed"],
    ["REJECTED", "Rejected"],
    ["WITHDRAWN", "Withdrawn"],
    ["PENDING_SCHEDULE", "Awaiting schedule"],
    ["PROPOSED", "Proposed"],
    ["CONFIRMED", "Confirmed"],
    ["RESCHEDULED", "Rescheduled"],
    ["CREATED", "Created"],
    ["ACTIVE", "Active"],
    ["INACTIVE", "Inactive"],
    ["SUSPENDED", "Suspended"],
    ["UNVERIFIED", "Not verified"],
    ["VERIFIED", "Verified"],
    ["UNDER_REVIEW", "Under review"],
    ["APPROVED", "Approved"],
    ["RESUBMISSION_REQUIRED", "Resubmission Required"],
    ["OPEN", "Open"],
    ["RESOLVED", "Resolved"],
    ["CLOSED", "Closed"],
    ["PENDING_REVIEW", "Pending review"],
    ["DECLINED", "Declined"],
  ])("renders the expected label for status %s", (status, expectedLabel) => {
    render(<StatusBadge status={status} />);
    expect(screen.getByText(expectedLabel)).toBeTruthy();
  });

  it("falls back to a title-cased version of the raw status for an unmapped value", () => {
    expect(() => render(<StatusBadge status="NO_SHOW" />)).not.toThrow();
    expect(screen.getByText("No Show")).toBeTruthy();
  });

  it("falls back gracefully for a completely unknown status string", () => {
    expect(() => render(<StatusBadge status="SOME_FUTURE_STATUS" />)).not.toThrow();
    expect(screen.getByText("Some Future Status")).toBeTruthy();
  });

  it("uses an explicit label override instead of the derived one", () => {
    render(<StatusBadge status="PUBLISHED" label="Custom label" />);
    expect(screen.getByText("Custom label")).toBeTruthy();
    expect(screen.queryByText("Open")).toBeNull();
  });
});
