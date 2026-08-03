import type { ServiceRequestStatusValue } from "@/domain/repositories/service-request-repository";

/**
 * Module 28 — Workflow Completion: pure, dependency-free rule for when a
 * ServiceRequest should auto-transition to EXPIRED. Same "small dependency-
 * free domain helper" convention as service-request-state.ts (which this
 * file deliberately does not modify — expiration is a distinct concern from
 * "is this request currently editable/cancellable/acceptable").
 *
 * A request is only expirable while it is still in an "open" state that a
 * professional could act on — PUBLISHED (open for quotes) or QUOTED (has at
 * least one quote, but the customer hasn't accepted one yet). Once a
 * request reaches ACCEPTED/IN_PROGRESS/COMPLETED/CANCELLED/DISPUTED it has
 * already left the "waiting on the marketplace" phase and `expiresAt`
 * becomes irrelevant — it is never re-checked or cleared for those states,
 * consistent with `expiresAt` being a nullable, best-effort field the
 * business only ever set at creation time for un-progressed requests.
 */
export const EXPIRABLE_SERVICE_REQUEST_STATUSES: readonly ServiceRequestStatusValue[] = ["PUBLISHED", "QUOTED"];

export function isServiceRequestExpirable(
  status: ServiceRequestStatusValue,
  expiresAt: Date | null,
  now: Date,
): boolean {
  if (!expiresAt) return false;
  if (!EXPIRABLE_SERVICE_REQUEST_STATUSES.includes(status)) return false;
  return expiresAt.getTime() <= now.getTime();
}
