import { StatusBadge } from "@/components/dashboard/status-badge";

/**
 * Booking & Scheduling module (Module 10). Same pattern as
 * QuoteStatusBadge/RequestStatusBadge — this module implements
 * PENDING_SCHEDULE/PROPOSED/CONFIRMED/CANCELLED/RESCHEDULED (see
 * domain/services/appointment-state.ts); SCHEDULED, IN_PROGRESS, and
 * NO_SHOW are never written by any code path but fall back to the raw
 * status string if ever encountered. COMPLETED is written by the Order /
 * Job Lifecycle module's CompleteAppointmentUseCase (Module 11).
 *
 * Delegates to the shared `StatusBadge` (Module 30.3) for the actual
 * color/label mapping — kept as its own named component so every existing
 * call site across the app keeps working unchanged.
 */
export function AppointmentStatusBadge({ status }: { status: string }) {
  return <StatusBadge status={status} label={status === "PENDING_SCHEDULE" ? "Awaiting a proposed time" : undefined} />;
}
