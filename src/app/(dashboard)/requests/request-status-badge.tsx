const STATUS_STYLES: Record<string, string> = {
  DRAFT: "bg-black/5 text-foreground/70",
  PUBLISHED: "bg-green-50 text-green-700",
  QUOTED: "bg-blue-50 text-blue-700",
  ACCEPTED: "bg-blue-50 text-blue-700",
  IN_PROGRESS: "bg-amber-50 text-amber-700",
  COMPLETED: "bg-green-50 text-green-700",
  CANCELLED: "bg-red-50 text-red-700",
  EXPIRED: "bg-black/5 text-foreground/70",
  DISPUTED: "bg-red-50 text-red-700",
};

const STATUS_LABELS: Record<string, string> = {
  DRAFT: "Draft",
  PUBLISHED: "Open",
  QUOTED: "Quoted",
  ACCEPTED: "Accepted",
  IN_PROGRESS: "In progress",
  COMPLETED: "Completed",
  CANCELLED: "Cancelled",
  EXPIRED: "Expired",
  DISPUTED: "Disputed",
};

/**
 * Displays PUBLISHED as "Open" — the business-facing name for this MVP's
 * only editable/cancellable state (see service-request-state.ts). Every
 * other enum value is shown as-is; this module doesn't drive any of those
 * transitions itself, it just needs to render them if a future module ever
 * sets one on a request this customer is viewing.
 */
export function RequestStatusBadge({ status }: { status: string }) {
  return (
    <span
      className={`rounded-full px-3 py-1 text-xs font-medium ${STATUS_STYLES[status] ?? "bg-black/5"}`}
    >
      {STATUS_LABELS[status] ?? status}
    </span>
  );
}
