import type { TimelineStep } from "./status-timeline";

/**
 * Maps an Appointment's current status to the steps `StatusTimeline`
 * should render. Display-only ordering of the happy path (Pending →
 * Proposed → Confirmed → Completed) — see
 * `domain/services/appointment-state.ts` for the actual transition rules
 * this deliberately does not duplicate.
 *
 * Module 120 — Multilingual Localization: steps carry only the status
 * `key`; `StatusTimeline` renders the localized `enums.status.<key>` label.
 */
export function getAppointmentTimelineSteps(status: string): TimelineStep[] {
  const order = ["PENDING_SCHEDULE", "PROPOSED", "CONFIRMED", "COMPLETED"];
  const happyPath: TimelineStep[] = order.map((key) => ({ key, state: "upcoming" }));

  const negativeTerminalStatuses = new Set(["CANCELLED", "RESCHEDULED"]);

  if (negativeTerminalStatuses.has(status)) {
    return [
      { key: "PENDING_SCHEDULE", state: "complete" },
      { key: status, state: "danger" },
    ];
  }

  const currentIndex = order.indexOf(status);

  return happyPath.map((step, index) => {
    if (currentIndex === -1) return step;
    if (index < currentIndex) return { ...step, state: "complete" };
    if (index === currentIndex) return { ...step, state: index === order.length - 1 ? "complete" : "current" };
    return step;
  });
}
