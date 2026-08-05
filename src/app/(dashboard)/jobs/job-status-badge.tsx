import { StatusBadge } from "@/components/dashboard/status-badge";

/**
 * Order / Job Lifecycle module (Module 11). Same pattern as
 * AppointmentStatusBadge/QuoteStatusBadge/RequestStatusBadge.
 *
 * Delegates to the shared `StatusBadge` (Module 30.3) for the actual
 * color/label mapping — kept as its own named component so every existing
 * call site across the app keeps working unchanged.
 */
export function JobStatusBadge({ status }: { status: string }) {
  return <StatusBadge status={status} label={status === "CREATED" ? "Not started" : undefined} />;
}
