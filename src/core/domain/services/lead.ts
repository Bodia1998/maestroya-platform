import { DomainError } from "@/domain/errors/domain-error";
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
 * Lifecycle TRANSITIONS are intentionally NOT modelled here (Module 124+:
 * publish / close / expire / cancel). Module 123 only guarantees that a
 * persisted status is one of the known values.
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
