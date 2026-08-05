import { StatusBadge } from "@/components/dashboard/status-badge";

/**
 * Displays PUBLISHED as "Open" — the business-facing name for this MVP's
 * only editable/cancellable state (see service-request-state.ts). Every
 * other enum value is shown as-is; this module doesn't drive any of those
 * transitions itself, it just needs to render them if a future module ever
 * sets one on a request this customer is viewing.
 *
 * Delegates to the shared `StatusBadge` (Module 30.3) for the actual
 * color/label mapping — kept as its own named component so every existing
 * call site across the app keeps working unchanged.
 */
export function RequestStatusBadge({ status }: { status: string }) {
  return <StatusBadge status={status} />;
}
