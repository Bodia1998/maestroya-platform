import { StatusBadge } from "@/components/dashboard/status-badge";

/**
 * Displays a Quote's status. SENT/VIEWED are the two "awaiting the
 * customer's decision" states this module's edit/withdraw actions remain
 * available for (see domain/services/quote-state.ts) — every other value
 * is shown as-is; this module never sets ACCEPTED/REJECTED/EXPIRED itself,
 * it just needs to render them if a future module ever does.
 *
 * Delegates to the shared `StatusBadge` (Module 30.3) for the actual
 * color/label mapping — kept as its own named component so every existing
 * call site across the app keeps working unchanged.
 */
export function QuoteStatusBadge({ status }: { status: string }) {
  return <StatusBadge status={status} />;
}
