const STATUS_STYLES: Record<string, string> = {
  PENDING: "bg-black/5 text-foreground/70",
  SENT: "bg-blue-50 text-blue-700",
  VIEWED: "bg-blue-50 text-blue-700",
  ACCEPTED: "bg-green-50 text-green-700",
  REJECTED: "bg-red-50 text-red-700",
  EXPIRED: "bg-black/5 text-foreground/70",
  WITHDRAWN: "bg-black/5 text-foreground/70",
};

const STATUS_LABELS: Record<string, string> = {
  PENDING: "Pending",
  SENT: "Sent",
  VIEWED: "Viewed",
  ACCEPTED: "Accepted",
  REJECTED: "Rejected",
  EXPIRED: "Expired",
  WITHDRAWN: "Withdrawn",
};

/**
 * Displays a Quote's status. SENT/VIEWED are the two "awaiting the
 * customer's decision" states this module's edit/withdraw actions remain
 * available for (see domain/services/quote-state.ts) — every other value
 * is shown as-is; this module never sets ACCEPTED/REJECTED/EXPIRED itself,
 * it just needs to render them if a future module ever does.
 */
export function QuoteStatusBadge({ status }: { status: string }) {
  return (
    <span
      className={`rounded-full px-3 py-1 text-xs font-medium ${STATUS_STYLES[status] ?? "bg-black/5"}`}
    >
      {STATUS_LABELS[status] ?? status}
    </span>
  );
}
