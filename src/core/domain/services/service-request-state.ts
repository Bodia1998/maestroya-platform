import type { ServiceRequestStatusValue } from "@/domain/repositories/service-request-repository";

/**
 * Service Request Module: state-transition rules, kept as a small
 * dependency-free domain helper (same style as geo-distance.ts) rather than
 * inlined checks scattered across use cases, so "what counts as editable /
 * cancellable" has exactly one definition.
 *
 * Business/schema reconciliation: the business spec describes an initial
 * status "OPEN" with future states IN_PROGRESS, ACCEPTED, COMPLETED,
 * CANCELLED, EXPIRED. The existing `ServiceRequestStatus` enum (added ahead
 * of this module, in the "complete domain model" phase) uses PUBLISHED
 * instead of OPEN, plus extra states (DRAFT, QUOTED, DISPUTED) anticipating
 * a fuller future workflow this module does not implement yet.
 *
 * Decision: this MVP creates and immediately publishes a request (no
 * separate draft-save workflow), so a request is created with
 * status = PUBLISHED, and PUBLISHED is treated as the OPEN-equivalent state
 * everywhere in this module's business logic — "only OPEN requests can be
 * edited/cancelled" becomes "only PUBLISHED requests can be
 * edited/cancelled". The other enum values are left untouched for future
 * modules (Offers/Quotes, scheduling, disputes, expiry).
 */
export const OPEN_EQUIVALENT_STATUS: ServiceRequestStatusValue = "PUBLISHED";
export const CANCELLED_STATUS: ServiceRequestStatusValue = "CANCELLED";

export function isEditableStatus(status: ServiceRequestStatusValue): boolean {
  return status === OPEN_EQUIVALENT_STATUS;
}

export function isCancellableStatus(status: ServiceRequestStatusValue): boolean {
  return status === OPEN_EQUIVALENT_STATUS;
}
