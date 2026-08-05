import { describe, expect, it } from "vitest";

import { getAppointmentTimelineSteps } from "@/components/dashboard/appointment-timeline-steps";

describe("getAppointmentTimelineSteps", () => {
  it("marks Pending as current for a PENDING_SCHEDULE appointment", () => {
    const steps = getAppointmentTimelineSteps("PENDING_SCHEDULE");
    expect(steps.map((s) => s.state)).toEqual(["current", "upcoming", "upcoming", "upcoming"]);
  });

  it("marks Pending complete and Proposed current for a PROPOSED appointment", () => {
    const steps = getAppointmentTimelineSteps("PROPOSED");
    expect(steps.map((s) => s.state)).toEqual(["complete", "current", "upcoming", "upcoming"]);
  });

  it("marks Pending/Proposed complete and Confirmed current for a CONFIRMED appointment", () => {
    const steps = getAppointmentTimelineSteps("CONFIRMED");
    expect(steps.map((s) => s.state)).toEqual(["complete", "complete", "current", "upcoming"]);
  });

  it("marks every step complete for a COMPLETED appointment", () => {
    const steps = getAppointmentTimelineSteps("COMPLETED");
    expect(steps.map((s) => s.state)).toEqual(["complete", "complete", "complete", "complete"]);
  });

  it("renders a two-step danger path for CANCELLED", () => {
    const steps = getAppointmentTimelineSteps("CANCELLED");
    expect(steps).toEqual([
      { key: "PENDING_SCHEDULE", label: "Pending", state: "complete" },
      { key: "CANCELLED", label: "Cancelled", state: "danger" },
    ]);
  });

  it("renders a two-step danger path for RESCHEDULED", () => {
    const steps = getAppointmentTimelineSteps("RESCHEDULED");
    expect(steps[1]).toEqual({ key: "RESCHEDULED", label: "Rescheduled", state: "danger" });
  });
});
