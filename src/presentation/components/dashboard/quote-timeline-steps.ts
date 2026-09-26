import type { TimelineStep } from "./status-timeline";

/**
 * Maps a Quote's current status to the steps `StatusTimeline` should
 * render. Display-only ordering of the happy path (Sent → Viewed →
 * Accepted) — the actual set of valid transitions between statuses is
 * owned entirely by `domain/services/quote-state.ts` and is untouched by
 * this file; a quote can reach `ACCEPTED` from `SENT` directly (skipping
 * `VIEWED`) and this still renders sensibly, marking `Viewed` complete
 * rather than requiring it to have literally happened.
 *
 * Module 120 — Multilingual Localization: steps carry only the status
 * `key`; `StatusTimeline` renders the localized `enums.status.<key>` label.
 */
export function getQuoteTimelineSteps(status: string): TimelineStep[] {
  const order = ["SENT", "VIEWED", "ACCEPTED"];
  const happyPath: TimelineStep[] = order.map((key) => ({ key, state: "upcoming" }));

  const negativeTerminalStatuses = new Set(["REJECTED", "WITHDRAWN", "EXPIRED"]);

  if (negativeTerminalStatuses.has(status)) {
    // A negative terminal outcome replaces whichever step it interrupted —
    // Sent always happened (a quote can't be withdrawn/rejected/expired
    // before it was sent), so that much of the happy path stays "complete".
    return [
      { key: "SENT", state: "complete" },
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
