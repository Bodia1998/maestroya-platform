import { describe, expect, it } from "vitest";

import { getQuoteTimelineSteps } from "@/components/dashboard/quote-timeline-steps";

describe("getQuoteTimelineSteps", () => {
  it("marks Sent as current and the rest upcoming for a SENT quote", () => {
    const steps = getQuoteTimelineSteps("SENT");
    expect(steps.map((s) => s.state)).toEqual(["current", "upcoming", "upcoming"]);
  });

  it("marks Sent complete and Viewed current for a VIEWED quote", () => {
    const steps = getQuoteTimelineSteps("VIEWED");
    expect(steps.map((s) => s.state)).toEqual(["complete", "current", "upcoming"]);
  });

  it("marks every step complete for an ACCEPTED quote", () => {
    const steps = getQuoteTimelineSteps("ACCEPTED");
    expect(steps.map((s) => s.state)).toEqual(["complete", "complete", "complete"]);
  });

  it("renders a two-step danger path for REJECTED", () => {
    const steps = getQuoteTimelineSteps("REJECTED");
    expect(steps).toEqual([
      { key: "SENT", label: "Sent", state: "complete" },
      { key: "REJECTED", label: "Rejected", state: "danger" },
    ]);
  });

  it("renders a two-step danger path for WITHDRAWN", () => {
    const steps = getQuoteTimelineSteps("WITHDRAWN");
    expect(steps[1]).toEqual({ key: "WITHDRAWN", label: "Withdrawn", state: "danger" });
  });

  it("renders a two-step danger path for EXPIRED", () => {
    const steps = getQuoteTimelineSteps("EXPIRED");
    expect(steps[1]).toEqual({ key: "EXPIRED", label: "Expired", state: "danger" });
  });

  it("returns the happy path unmodified for an unrecognized status", () => {
    const steps = getQuoteTimelineSteps("PENDING");
    expect(steps.map((s) => s.state)).toEqual(["upcoming", "upcoming", "upcoming"]);
  });
});
