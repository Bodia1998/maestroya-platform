import type { TimelineStep } from "./status-timeline";

/**
 * Maps a Quote's current status to the steps `StatusTimeline` should
 * render. Display-only ordering of the happy path (Sent → Viewed →
 * Accepted) — the actual set of valid transitions between statuses is
 * owned entirely by `domain/services/quote-state.ts` and is untouched by
 * this file; a quote can reach `ACCEPTED` from `SENT` directly (skipping
 * `VIEWED`) and this still renders sensibly, marking `Viewed` complete
 * rather than requiring it to have literally happened.
 */
export function getQuoteTimelineSteps(status: string): TimelineStep[] {
  const happyPath: TimelineStep[] = [
    { key: "SENT", label: "Sent", state: "upcoming" },
    { key: "VIEWED", label: "Viewed", state: "upcoming" },
    { key: "ACCEPTED", label: "Accepted", state: "upcoming" },
  ];

  const negativeTerminalLabel: Record<string, string> = {
    REJECTED: "Rejected",
    WITHDRAWN: "Withdrawn",
    EXPIRED: "Expired",
  };

  if (status in negativeTerminalLabel) {
    // A negative terminal outcome replaces whichever step it interrupted —
    // Sent always happened (a quote can't be withdrawn/rejected/expired
    // before it was sent), so that much of the happy path stays "complete".
    return [
      { key: "SENT", label: "Sent", state: "complete" },
      { key: status, label: negativeTerminalLabel[status]!, state: "danger" },
    ];
  }

  const order = ["SENT", "VIEWED", "ACCEPTED"];
  const currentIndex = order.indexOf(status);

  return happyPath.map((step, index) => {
    if (currentIndex === -1) return step;
    if (index < currentIndex) return { ...step, state: "complete" };
    if (index === currentIndex) return { ...step, state: index === order.length - 1 ? "complete" : "current" };
    return step;
  });
}
