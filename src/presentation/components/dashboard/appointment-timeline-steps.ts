import type { TimelineStep } from "./status-timeline";

/**
 * Maps an Appointment's current status to the steps `StatusTimeline`
 * should render. Display-only ordering of the happy path (Pending →
 * Proposed → Confirmed → Completed) — see
 * `domain/services/appointment-state.ts` for the actual transition rules
 * this deliberately does not duplicate.
 */
export function getAppointmentTimelineSteps(status: string): TimelineStep[] {
  const happyPath: TimelineStep[] = [
    { key: "PENDING_SCHEDULE", label: "Pending", state: "upcoming" },
    { key: "PROPOSED", label: "Proposed", state: "upcoming" },
    { key: "CONFIRMED", label: "Confirmed", state: "upcoming" },
    { key: "COMPLETED", label: "Completed", state: "upcoming" },
  ];

  const negativeTerminalLabel: Record<string, string> = {
    CANCELLED: "Cancelled",
    RESCHEDULED: "Rescheduled",
  };

  if (status in negativeTerminalLabel) {
    return [
      { key: "PENDING_SCHEDULE", label: "Pending", state: "complete" },
      { key: status, label: negativeTerminalLabel[status]!, state: "danger" },
    ];
  }

  const order = ["PENDING_SCHEDULE", "PROPOSED", "CONFIRMED", "COMPLETED"];
  const currentIndex = order.indexOf(status);

  return happyPath.map((step, index) => {
    if (currentIndex === -1) return step;
    if (index < currentIndex) return { ...step, state: "complete" };
    if (index === currentIndex) return { ...step, state: index === order.length - 1 ? "complete" : "current" };
    return step;
  });
}
