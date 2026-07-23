const STATUS_STYLES: Record<string, string> = {
  CREATED: "bg-black/5 text-foreground/70",
  IN_PROGRESS: "bg-blue-50 text-blue-700",
  COMPLETED: "bg-green-50 text-green-700",
  CANCELLED: "bg-red-50 text-red-700",
};

const STATUS_LABELS: Record<string, string> = {
  CREATED: "Not started",
  IN_PROGRESS: "In progress",
  COMPLETED: "Completed",
  CANCELLED: "Cancelled",
};

/**
 * Order / Job Lifecycle module (Module 11). Same pattern as
 * AppointmentStatusBadge/QuoteStatusBadge/RequestStatusBadge.
 */
export function JobStatusBadge({ status }: { status: string }) {
  return (
    <span className={`rounded-full px-3 py-1 text-xs font-medium ${STATUS_STYLES[status] ?? "bg-black/5"}`}>
      {STATUS_LABELS[status] ?? status}
    </span>
  );
}
