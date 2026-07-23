const STATUS_STYLES: Record<string, string> = {
  PENDING_SCHEDULE: "bg-black/5 text-foreground/70",
  PROPOSED: "bg-blue-50 text-blue-700",
  CONFIRMED: "bg-green-50 text-green-700",
  COMPLETED: "bg-green-50 text-green-700",
  CANCELLED: "bg-red-50 text-red-700",
  RESCHEDULED: "bg-black/5 text-foreground/70",
};

const STATUS_LABELS: Record<string, string> = {
  PENDING_SCHEDULE: "Awaiting a proposed time",
  PROPOSED: "Time proposed",
  CONFIRMED: "Confirmed",
  COMPLETED: "Completed",
  CANCELLED: "Cancelled",
  RESCHEDULED: "Rescheduled",
};

/**
 * Booking & Scheduling module (Module 10). Same pattern as
 * QuoteStatusBadge/RequestStatusBadge — this module implements
 * PENDING_SCHEDULE/PROPOSED/CONFIRMED/CANCELLED/COMPLETED/RESCHEDULED (see
 * domain/services/appointment-state.ts); SCHEDULED, IN_PROGRESS, and
 * NO_SHOW are never written by any code path but fall back to the raw
 * status string if ever encountered.
 */
export function AppointmentStatusBadge({ status }: { status: string }) {
  return (
    <span className={`rounded-full px-3 py-1 text-xs font-medium ${STATUS_STYLES[status] ?? "bg-black/5"}`}>
      {STATUS_LABELS[status] ?? status}
    </span>
  );
}
