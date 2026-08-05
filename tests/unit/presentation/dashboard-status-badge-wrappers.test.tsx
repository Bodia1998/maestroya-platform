/**
 * Regression coverage for the Module 30.3 refactor that turned each
 * per-module status badge (RequestStatusBadge, AppointmentStatusBadge,
 * QuoteStatusBadge, JobStatusBadge, StatusBadges) into a thin wrapper
 * around the shared `StatusBadge`. Confirms the visible label each one
 * renders for the real status values its own module's call sites actually
 * pass in is unchanged by the delegation.
 */
import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { AppointmentStatusBadge } from "@/app/(dashboard)/appointments/appointment-status-badge";
import { StatusBadges } from "@/app/(dashboard)/dashboard/professional/status-badges";
import { QuoteStatusBadge } from "@/app/(dashboard)/dashboard/professional/quotes/quote-status-badge";
import { JobStatusBadge } from "@/app/(dashboard)/jobs/job-status-badge";
import { RequestStatusBadge } from "@/app/(dashboard)/requests/request-status-badge";

describe("RequestStatusBadge", () => {
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
  ])("renders %s as %s (ServiceRequestStatus)", (status, label) => {
    render(<RequestStatusBadge status={status} />);
    expect(screen.getByText(label)).toBeTruthy();
  });
});

describe("QuoteStatusBadge", () => {
  it.each([
    ["PENDING", "Pending"],
    ["SENT", "Sent"],
    ["VIEWED", "Viewed"],
    ["ACCEPTED", "Accepted"],
    ["REJECTED", "Rejected"],
    ["EXPIRED", "Expired"],
    ["WITHDRAWN", "Withdrawn"],
  ])("renders %s as %s (QuoteStatus)", (status, label) => {
    render(<QuoteStatusBadge status={status} />);
    expect(screen.getByText(label)).toBeTruthy();
  });
});

describe("AppointmentStatusBadge", () => {
  it.each([
    ["SCHEDULED", "Scheduled"],
    ["PROPOSED", "Proposed"],
    ["CONFIRMED", "Confirmed"],
    ["IN_PROGRESS", "In progress"],
    ["COMPLETED", "Completed"],
    ["CANCELLED", "Cancelled"],
    ["NO_SHOW", "No Show"],
    ["RESCHEDULED", "Rescheduled"],
  ])("renders %s as %s (AppointmentStatus)", (status, label) => {
    render(<AppointmentStatusBadge status={status} />);
    expect(screen.getByText(label)).toBeTruthy();
  });

  it("overrides PENDING_SCHEDULE with a friendlier label than the shared default", () => {
    render(<AppointmentStatusBadge status="PENDING_SCHEDULE" />);
    expect(screen.getByText("Awaiting a proposed time")).toBeTruthy();
    expect(screen.queryByText("Awaiting schedule")).toBeNull();
  });
});

describe("JobStatusBadge", () => {
  it("overrides CREATED with 'Not started'", () => {
    render(<JobStatusBadge status="CREATED" />);
    expect(screen.getByText("Not started")).toBeTruthy();
  });

  it.each([
    ["IN_PROGRESS", "In progress"],
    ["COMPLETED", "Completed"],
    ["CANCELLED", "Cancelled"],
  ])("renders %s as %s (JobStatus)", (status, label) => {
    render(<JobStatusBadge status={status} />);
    expect(screen.getByText(label)).toBeTruthy();
  });
});

describe("StatusBadges", () => {
  it("renders both the profile status (prefixed) and the verification status badges", () => {
    render(<StatusBadges status="ACTIVE" verificationStatus="VERIFIED" />);
    expect(screen.getByText("Status: ACTIVE")).toBeTruthy();
    expect(screen.getByText("Verified")).toBeTruthy();
  });

  it.each([
    ["ACTIVE", "INACTIVE"],
    ["ACTIVE", "SUSPENDED"],
  ])("renders profile status %s with an unmapped-friendly verification status %s without throwing", (status, verificationStatus) => {
    expect(() => render(<StatusBadges status={status} verificationStatus={verificationStatus} />)).not.toThrow();
  });

  it.each([
    ["UNVERIFIED", "Not verified"],
    ["PENDING", "Pending"],
    ["VERIFIED", "Verified"],
    ["REJECTED", "Rejected"],
  ])("renders verificationStatus %s as %s (VerificationStatus)", (verificationStatus, label) => {
    render(<StatusBadges status="ACTIVE" verificationStatus={verificationStatus} />);
    expect(screen.getByText(label)).toBeTruthy();
  });
});
