import { DomainError } from "@/domain/errors/domain-error";
import type { ServiceRequestStatusValue } from "@/domain/repositories/service-request-repository";
import type { TransactionFlowVersion } from "@/domain/services/transaction-flow";

/**
 * Module 123 — Lead Marketplace: pure domain rules for the `Lead`
 * aggregate (the marketplace opportunity derived from a ServiceRequest).
 *
 * A Lead is deliberately thin. The customer's real request data stays on
 * ServiceRequest; a Lead holds only identity, the ServiceRequest link, a
 * lifecycle status and the configurable buyer rule. It never carries
 * customer contact data.
 *
 * Module 123 only guaranteed that a persisted status is one of the known
 * values; Module 124 added publish; Module 130 completes the lifecycle
 * (see "Module 130" below).
 */
export const LEAD_STATUSES = ["DRAFT", "PUBLISHED", "CLOSED", "EXPIRED", "CANCELLED"] as const;
export type LeadStatus = (typeof LEAD_STATUSES)[number];

export const INITIAL_LEAD_STATUS: LeadStatus = "DRAFT";

export function isLeadStatus(value: unknown): value is LeadStatus {
  return typeof value === "string" && (LEAD_STATUSES as readonly string[]).includes(value);
}

/** The only flow a Lead may belong to. */
export const LEAD_FLOW_VERSION = "LEAD_V1" as const satisfies TransactionFlowVersion;

/** Thrown when a Lead would be created for (or resolves to) a ServiceRequest
 *  that is not LEAD_V1 — i.e. it would silently represent a legacy
 *  quote/payment request. */
export class InvalidLeadFlowError extends DomainError {
  readonly code = "INVALID_LEAD_FLOW";

  constructor(readonly flowVersion: string | null | undefined) {
    super(`A Lead can only be created for a "${LEAD_FLOW_VERSION}" ServiceRequest (got "${String(flowVersion)}").`);
  }
}

/** Thrown when a ServiceRequest already has its (single) Lead. */
export class LeadAlreadyExistsError extends DomainError {
  readonly code = "LEAD_ALREADY_EXISTS";

  constructor(serviceRequestId: string) {
    super(`ServiceRequest "${serviceRequestId}" already has a Lead.`);
  }
}

export class InvalidLeadMaxBuyersError extends DomainError {
  readonly code = "INVALID_LEAD_MAX_BUYERS";

  constructor(value: unknown) {
    super(`Lead maxBuyers must be null (not configured) or an integer >= 1 (got ${String(value)}).`);
  }
}

/**
 * Module 124 — publish rule (DRAFT -> PUBLISHED). The remaining transitions
 * are modelled by the Module 130 state machine below.
 */
export const LEAD_PUBLISHABLE_FROM_STATUS: LeadStatus = "DRAFT";

export function canPublishLead(status: LeadStatus): boolean {
  return status === LEAD_PUBLISHABLE_FROM_STATUS;
}

/** Thrown for any status that may not move to PUBLISHED (CLOSED, EXPIRED,
 *  CANCELLED). A Lead that is already PUBLISHED is NOT an error: publish is
 *  idempotent and handled by the use case. */
export class LeadNotPublishableError extends DomainError {
  readonly code = "LEAD_NOT_PUBLISHABLE";

  constructor(readonly status: LeadStatus) {
    super(`A Lead in status "${status}" cannot be published.`);
  }
}

export function assertLeadPublishable(status: LeadStatus): void {
  if (!canPublishLead(status)) throw new LeadNotPublishableError(status);
}

/**
 * ServiceRequest state that may back a Lead. PUBLISHED is the project's
 * existing "open" state (see service-request-state.ts); no new status is
 * introduced.
 */
export const LEAD_ELIGIBLE_REQUEST_STATUS: ServiceRequestStatusValue = "PUBLISHED";

export type LeadRequestIneligibilityReason = "REQUEST_NOT_OPEN" | "REQUEST_INCOMPLETE";

export class ServiceRequestNotEligibleForLeadError extends DomainError {
  readonly code = "SERVICE_REQUEST_NOT_ELIGIBLE_FOR_LEAD";

  constructor(readonly reason: LeadRequestIneligibilityReason) {
    super("This service request is not eligible to be a Lead.");
  }
}

/** Minimum information a professional needs to understand a Lead. Mirrors
 *  what ServiceRequest creation already requires (title, description and
 *  location city are mandatory); no new required fields are invented. */
export interface LeadRequestEligibilityInput {
  status: ServiceRequestStatusValue;
  title: string;
  description: string;
  location: { city: string };
}

export function assertServiceRequestEligibleForLead(request: LeadRequestEligibilityInput): void {
  if (request.status !== LEAD_ELIGIBLE_REQUEST_STATUS) throw new ServiceRequestNotEligibleForLeadError("REQUEST_NOT_OPEN");
  if (request.title.trim() === "" || request.description.trim() === "" || request.location.city.trim() === "") {
    throw new ServiceRequestNotEligibleForLeadError("REQUEST_INCOMPLETE");
  }
}

/** Enforces the invariant "Lead -> LEAD_V1". */
export function assertLeadEligibleFlow(flow: string | null | undefined): asserts flow is typeof LEAD_FLOW_VERSION {
  if (flow !== LEAD_FLOW_VERSION) throw new InvalidLeadFlowError(flow);
}

/**
 * `null`/`undefined` = "buyer policy not configured yet". That is NOT
 * "unlimited" and NOT "exclusive": the exclusive-vs-shared business
 * decision is unresolved, so no policy is encoded here.
 */
export function normalizeLeadMaxBuyers(value: number | null | undefined): number | null {
  if (value === null || value === undefined) return null;
  if (!Number.isInteger(value) || value < 1) throw new InvalidLeadMaxBuyersError(value);
  return value;
}

/**
 * Module 130 — Lead lifecycle completion & request propagation.
 *
 * State machine (no new states; the Module 123 enum is sufficient):
 *
 *   DRAFT ──publish──▶ PUBLISHED
 *   DRAFT | PUBLISHED ──▶ CLOSED | EXPIRED | CANCELLED   (terminal)
 *
 * - DRAFT      : lead exists, not available to professionals.
 * - PUBLISHED  : available (subject to the request still being eligible).
 * - CLOSED     : the request left the open state for a reason other than
 *                cancellation/expiry (completed / accepted / in progress /
 *                quoted / disputed) — the lead is no longer on offer.
 * - EXPIRED    : the underlying request expired.
 * - CANCELLED  : the underlying request was cancelled.
 *
 * CLOSED / EXPIRED / CANCELLED are TERMINAL: a lead never becomes available
 * again and never moves between terminal states (the first terminal state
 * wins). Repeating a transition to the state a lead is already in is a
 * no-op, not an error (idempotent) — see `isLeadTransitionNoop`.
 *
 * Existing LeadPurchase rows are never touched by lifecycle transitions
 * (no deletion, no detaching, no status change). What happens to a purchase
 * on a terminal lead (expiry of unpaid purchases, refund of paid ones) is
 * owned by later modules (M137 / M153).
 */
export const LEAD_TERMINAL_STATUSES = ["CLOSED", "EXPIRED", "CANCELLED"] as const satisfies readonly LeadStatus[];
export type LeadTerminalStatus = (typeof LEAD_TERMINAL_STATUSES)[number];

export function isTerminalLeadStatus(status: LeadStatus): status is LeadTerminalStatus {
  return (LEAD_TERMINAL_STATUSES as readonly LeadStatus[]).includes(status);
}

const LEAD_TRANSITIONS: Record<LeadStatus, readonly LeadStatus[]> = {
  DRAFT: ["PUBLISHED", "CLOSED", "EXPIRED", "CANCELLED"],
  PUBLISHED: ["CLOSED", "EXPIRED", "CANCELLED"],
  CLOSED: [],
  EXPIRED: [],
  CANCELLED: [],
};

export function canTransitionLead(from: LeadStatus, to: LeadStatus): boolean {
  return LEAD_TRANSITIONS[from].includes(to);
}

/** Repeating the transition a lead already went through is safe (no write, no error). */
export function isLeadTransitionNoop(from: LeadStatus, to: LeadStatus): boolean {
  return from === to;
}

/** The statuses from which `to` may be reached (used for status-conditional writes). */
export function leadStatusesThatMayTransitionTo(to: LeadStatus): LeadStatus[] {
  return LEAD_STATUSES.filter((from) => canTransitionLead(from, to));
}

export class InvalidLeadTransitionError extends DomainError {
  readonly code = "INVALID_LEAD_TRANSITION";

  constructor(
    readonly from: LeadStatus,
    readonly to: LeadStatus,
  ) {
    super(`A Lead cannot move from "${from}" to "${to}".`);
  }
}

/** Throws unless `from -> to` is a legal, non-repeated transition. */
export function assertLeadTransition(from: LeadStatus, to: LeadStatus): void {
  if (!canTransitionLead(from, to)) throw new InvalidLeadTransitionError(from, to);
}

/**
 * ServiceRequest -> Lead propagation rule: the Lead status a request status
 * forces, or `null` when the request status leaves the Lead alone.
 *
 * PUBLISHED is the "open" state (see service-request-state.ts) and DRAFT is
 * the pre-publication state: neither changes the Lead. Every other request
 * status means the request is no longer eligible for marketplace activity
 * (`LEAD_ELIGIBLE_REQUEST_STATUS`): CANCELLED/EXPIRED map to the matching
 * Lead state, everything else (QUOTED, ACCEPTED, IN_PROGRESS, COMPLETED,
 * DISPUTED) closes the Lead. For LEAD_V1 requests most of those are not
 * reachable today (no quotes); mapping them is a fail-safe so a lead can
 * never stay available behind an ineligible request.
 */
export function leadStatusForRequestStatus(requestStatus: ServiceRequestStatusValue): LeadTerminalStatus | null {
  switch (requestStatus) {
    case "DRAFT":
    case "PUBLISHED":
      return null;
    case "CANCELLED":
      return "CANCELLED";
    case "EXPIRED":
      return "EXPIRED";
    default:
      return "CLOSED";
  }
}

export interface LeadAvailabilityInput {
  leadStatus: LeadStatus;
  flowVersion: string | null | undefined;
  requestStatus: ServiceRequestStatusValue;
  /** Soft-deleted requests are never eligible. Defaults to not deleted. */
  requestDeleted?: boolean;
}

/**
 * Invariant: a LEAD_V1 lead is available for marketplace activity only if it
 * is PUBLISHED AND its underlying request is still eligible (open, not
 * deleted). The lead's own status is not trusted on its own, so a lead whose
 * status was never updated after the request became unavailable is still
 * reported unavailable. Pure policy for later modules (feed, purchase); it
 * performs no I/O and is not the feed itself.
 */
export function isLeadAvailableForMarketplace(input: LeadAvailabilityInput): boolean {
  return (
    input.flowVersion === LEAD_FLOW_VERSION &&
    input.leadStatus === "PUBLISHED" &&
    input.requestStatus === LEAD_ELIGIBLE_REQUEST_STATUS &&
    input.requestDeleted !== true
  );
}
