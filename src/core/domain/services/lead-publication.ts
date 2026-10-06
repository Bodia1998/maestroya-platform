import { DomainError } from "@/domain/errors/domain-error";
import { formatScaledDecimal, parseScaledDecimal } from "@/domain/services/fixed-point-decimal";
import {
  ServiceRequestNotEligibleForLeadError,
  assertLeadEligibleFlow,
  assertLeadPublishable,
  assertServiceRequestEligibleForLead,
  isLeadAvailableForMarketplace,
  type LeadAvailabilityInput,
  type LeadRequestEligibilityInput,
  type LeadStatus,
} from "@/domain/services/lead";
import { isLeadPricingConfidence, type LeadPricingConfidence, type LeadPricingResult } from "@/domain/services/lead-pricing";
import { LEAD_PURCHASE_CURRENCY } from "@/domain/services/lead-purchase";

/**
 * Module 133 — LEAD_V1 publication contract. Pure, no I/O.
 *
 * Answers ONE question: "can this Lead be safely published to the
 * marketplace, and what exact price / buyer policy is published with it?"
 * (Which professional sees which Lead is the Module 134 feed, not this.)
 *
 * A Lead is publishable only when ALL of the following hold:
 *   1. it is a LEAD_V1 Lead (`assertLeadEligibleFlow`);
 *   2. it is DRAFT (terminal Leads are never republished; an already
 *      PUBLISHED Lead is an idempotent no-op handled by the use case);
 *   3. its ServiceRequest is open, complete and not deleted
 *      (`assertServiceRequestEligibleForLead`, the Module 124/130 rule);
 *   4. the production pricing pipeline (Module 129 estimate -> Module 128
 *      price, run with the Module 132 configuration) produced a genuinely
 *      PRICED result (`evaluateLeadPublicationPricing`);
 *   5. the buyer policy is explicit and valid (`validateLeadBuyerPolicy`);
 *   6. the resulting snapshot is itself valid (`assertValidLeadPublicationSnapshotData`).
 * `status === PUBLISHED`, an open request or "a price exists" are NOT enough.
 *
 * What gets published is captured as an immutable `LeadPublicationSnapshot`
 * and stored with the status change in ONE conditional write. Marketplace
 * reads must use that snapshot and never recompute the price from mutable
 * configuration.
 *
 * Money: decimal STRINGS validated and normalised with the shared fixed-point
 * parser (bigint). No JS `number`, no floating point, no formatting round
 * trips.
 *
 * This module does NOT enforce purchase limits (M135/M137 own purchase
 * behaviour), compute tax, or decide who may buy.
 */

// ---------------------------------------------------------------------------
// Rejections
// ---------------------------------------------------------------------------

export const LEAD_PUBLICATION_REJECTION_REASONS = [
  "PRICING_CONFIGURATION_UNAVAILABLE",
  "PRICING_CONFIGURATION_INVALID",
  "UNPRICED",
  "CATEGORY_UNSUPPORTED",
  "CONFIDENCE_TOO_LOW",
  "PRICING_INPUT_INVALID",
  "PRICING_RESULT_MALFORMED",
  "BUYER_POLICY_INVALID",
  "SNAPSHOT_INVALID",
] as const;
export type LeadPublicationRejectionReason = (typeof LEAD_PUBLICATION_REJECTION_REASONS)[number];

/** The Lead may not be published (yet). The Lead stays DRAFT and publication is retryable. Fixed public message; the reason is for logs/tests. */
export class LeadPublicationRejectedError extends DomainError {
  readonly code = "LEAD_PUBLICATION_REJECTED";

  constructor(readonly reason: LeadPublicationRejectionReason) {
    super("This lead cannot be published right now.");
  }
}

// ---------------------------------------------------------------------------
// Buyer policy
// ---------------------------------------------------------------------------

/**
 * Explicit buyer policy published with a Lead: the maximum number of
 * successful buyers. `maxBuyers` 1 = exclusive, N = shared. The value is
 * supplied by a released, versioned configuration (never hard-coded in
 * marketplace logic); `policyVersion` is stored with every published Lead so
 * its policy stays attributable.
 */
export interface LeadBuyerPolicy {
  /** Lower-case slug identifying the released policy, e.g. "lead-buyer-policy-pilot-v1". */
  policyVersion: string;
  /** Integer >= 1: how many professionals may successfully purchase the Lead. */
  maxBuyers: number;
}

/** Typo guard for the configuration, not a business rule. */
export const MAX_LEAD_BUYERS_LIMIT = 100;
const POLICY_VERSION_PATTERN = /^[a-z0-9][a-z0-9._-]{0,63}$/;

export function isValidLeadBuyerPolicy(candidate: unknown): candidate is LeadBuyerPolicy {
  if (typeof candidate !== "object" || candidate === null) return false;
  const { policyVersion, maxBuyers } = candidate as Record<string, unknown>;
  return (
    typeof policyVersion === "string" &&
    POLICY_VERSION_PATTERN.test(policyVersion) &&
    typeof maxBuyers === "number" &&
    Number.isInteger(maxBuyers) &&
    maxBuyers >= 1 &&
    maxBuyers <= MAX_LEAD_BUYERS_LIMIT
  );
}

/**
 * Whether a PUBLISHED Lead can still take another buyer, given how many
 * active purchases it has. PURE policy for later modules; this module does not
 * enforce it (M135/M137 do, under a row lock). A Lead without a buyer policy
 * is never open for more purchases.
 */
export function isLeadOpenForAdditionalPurchases(snapshot: Pick<LeadPublicationSnapshot, "maxBuyers"> | null | undefined, activePurchaseCount: number): boolean {
  if (!snapshot || !Number.isInteger(snapshot.maxBuyers) || snapshot.maxBuyers < 1) return false;
  if (!Number.isInteger(activePurchaseCount) || activePurchaseCount < 0) return false;
  return activePurchaseCount < snapshot.maxBuyers;
}

// ---------------------------------------------------------------------------
// Priceability gate
// ---------------------------------------------------------------------------

/**
 * What a price source hands the gate: the raw pricing result PLUS the identity
 * of the configuration that produced it. `CONFIGURATION_UNAVAILABLE` means no
 * valid production pricing configuration exists (fail closed).
 */
export type LeadPublicationPriceOutcome =
  | { kind: "CONFIGURATION_UNAVAILABLE" }
  | {
      kind: "RESOLVED";
      /** LeadPricingProductionConfig.configVersion that produced the result. */
      configVersion: string;
      /** JobValueEstimationConfig.ruleVersion used for the estimate. */
      jobValueRuleVersion: string;
      result: LeadPricingResult;
    };

export interface LeadPublicationPricing {
  price: string;
  currency: typeof LEAD_PURCHASE_CURRENCY;
  estimatedJobValue: string;
  pricingRate: string;
  pricingConfidence: LeadPricingConfidence;
  pricingConfigVersion: string;
  jobValueRuleVersion: string;
  pricingRuleVersion: string;
}

export type LeadPublicationPricingEvaluation = { ok: true; pricing: LeadPublicationPricing } | { ok: false; reason: LeadPublicationRejectionReason };

/** Decimal(10,2) bound, the same one the engine and the schema use. */
const MAX_PRICE_CENTS = 9_999_999_999n;
const FIXED_ONE = 1_000_000n;

const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);
const nonEmptyString = (v: unknown): v is string => typeof v === "string" && v.trim() !== "";

function normalizedCents(raw: unknown): string | null {
  const cents = parseScaledDecimal(raw, 2);
  if (cents === null || cents <= 0n || cents > MAX_PRICE_CENTS) return null;
  return formatScaledDecimal(cents, 2, 2);
}

/**
 * The priceability gate. Only a genuinely PRICED, well-formed result passes.
 * Everything else — UNPRICED (any reason), CATEGORY_UNSUPPORTED,
 * CONFIDENCE_TOO_LOW, INVALID_INPUT, missing/invalid configuration, an unknown
 * status or a malformed object — is rejected. Never throws, never substitutes
 * a zero/placeholder price and never retries with another configuration.
 */
export function evaluateLeadPublicationPricing(outcome: unknown): LeadPublicationPricingEvaluation {
  if (!isRecord(outcome)) return { ok: false, reason: "PRICING_RESULT_MALFORMED" };
  if (outcome.kind === "CONFIGURATION_UNAVAILABLE") return { ok: false, reason: "PRICING_CONFIGURATION_UNAVAILABLE" };
  if (outcome.kind !== "RESOLVED") return { ok: false, reason: "PRICING_RESULT_MALFORMED" };

  const { configVersion, jobValueRuleVersion, result } = outcome;
  if (!nonEmptyString(configVersion) || !nonEmptyString(jobValueRuleVersion) || !isRecord(result)) {
    return { ok: false, reason: "PRICING_RESULT_MALFORMED" };
  }

  switch (result.status) {
    case "UNPRICED":
      if (result.reason === "CATEGORY_UNSUPPORTED") return { ok: false, reason: "CATEGORY_UNSUPPORTED" };
      if (result.reason === "CONFIDENCE_TOO_LOW") return { ok: false, reason: "CONFIDENCE_TOO_LOW" };
      return { ok: false, reason: "UNPRICED" };
    case "INVALID_INPUT":
      return { ok: false, reason: result.reason === "INVALID_CONFIGURATION" ? "PRICING_CONFIGURATION_INVALID" : "PRICING_INPUT_INVALID" };
    case "PRICED":
      break;
    default:
      return { ok: false, reason: "PRICING_RESULT_MALFORMED" };
  }

  const price = normalizedCents(result.price);
  const estimatedJobValue = normalizedCents(result.estimatedServiceValue);
  const rateFixed = parseScaledDecimal(result.rate, 6);
  if (
    price === null ||
    estimatedJobValue === null ||
    rateFixed === null ||
    rateFixed <= 0n ||
    rateFixed > FIXED_ONE ||
    result.currency !== LEAD_PURCHASE_CURRENCY ||
    !isLeadPricingConfidence(result.confidence) ||
    !nonEmptyString(result.ruleVersion)
  ) {
    return { ok: false, reason: "PRICING_RESULT_MALFORMED" };
  }

  return {
    ok: true,
    pricing: {
      price,
      currency: LEAD_PURCHASE_CURRENCY,
      estimatedJobValue,
      pricingRate: formatScaledDecimal(rateFixed, 6, 2),
      pricingConfidence: result.confidence,
      pricingConfigVersion: configVersion,
      jobValueRuleVersion,
      pricingRuleVersion: result.ruleVersion,
    },
  };
}

// ---------------------------------------------------------------------------
// Snapshot
// ---------------------------------------------------------------------------

/** Everything captured at publication, before the persistence layer stamps `publishedAt`. */
export interface LeadPublicationSnapshotData extends LeadPublicationPricing {
  buyerPolicyVersion: string;
  maxBuyers: number;
}

/** The immutable snapshot as stored. `publishedAt` is stamped by the repository, in the same write as the status. */
export interface LeadPublicationSnapshot extends LeadPublicationSnapshotData {
  publishedAt: Date;
}

export function buildLeadPublicationSnapshotData(pricing: LeadPublicationPricing, policy: LeadBuyerPolicy): LeadPublicationSnapshotData {
  return { ...pricing, buyerPolicyVersion: policy.policyVersion, maxBuyers: policy.maxBuyers };
}

/** Structural validity of snapshot data (used before writing and when judging readiness). */
export function isValidLeadPublicationSnapshotData(value: unknown): value is LeadPublicationSnapshotData {
  if (!isRecord(value)) return false;
  const price = parseScaledDecimal(value.price, 2);
  const job = parseScaledDecimal(value.estimatedJobValue, 2);
  const rate = parseScaledDecimal(value.pricingRate, 6);
  return (
    price !== null && price > 0n && price <= MAX_PRICE_CENTS &&
    job !== null && job > 0n && job <= MAX_PRICE_CENTS &&
    rate !== null && rate > 0n && rate <= FIXED_ONE &&
    value.currency === LEAD_PURCHASE_CURRENCY &&
    isLeadPricingConfidence(value.pricingConfidence) &&
    nonEmptyString(value.pricingConfigVersion) &&
    nonEmptyString(value.jobValueRuleVersion) &&
    nonEmptyString(value.pricingRuleVersion) &&
    isValidLeadBuyerPolicy({ policyVersion: value.buyerPolicyVersion, maxBuyers: value.maxBuyers })
  );
}

export function assertValidLeadPublicationSnapshotData(value: unknown): asserts value is LeadPublicationSnapshotData {
  if (!isValidLeadPublicationSnapshotData(value)) throw new LeadPublicationRejectedError("SNAPSHOT_INVALID");
}

/** A stored snapshot is complete: valid data AND a publication timestamp. */
export function isLeadPublicationSnapshotComplete(value: unknown): value is LeadPublicationSnapshot {
  return isValidLeadPublicationSnapshotData(value) && (value as { publishedAt?: unknown }).publishedAt instanceof Date;
}

// ---------------------------------------------------------------------------
// Eligibility (pre-publication) and readiness (post-publication)
// ---------------------------------------------------------------------------

export interface LeadPublicationEligibilityInput {
  leadStatus: LeadStatus;
  flowVersion: string | null | undefined;
  /** null/undefined = the request is missing or soft-deleted. */
  request: (LeadRequestEligibilityInput & { deleted?: boolean }) | null | undefined;
}

/**
 * PRE-publication eligibility of a DRAFT Lead. Deliberately separate from
 * `isLeadAvailableForMarketplace`, which describes an ALREADY published Lead;
 * this reuses the same building blocks (LEAD_V1, the one "open request"
 * definition, the M130 state machine) without redefining them.
 *
 * Throws InvalidLeadFlowError (missing/legacy flow: fail closed),
 * LeadNotPublishableError (terminal, or already published — callers handle the
 * idempotent PUBLISHED repeat before calling this) or
 * ServiceRequestNotEligibleForLeadError (deleted / not open / incomplete).
 */
export function assertLeadPublicationEligible(input: LeadPublicationEligibilityInput): void {
  assertLeadEligibleFlow(input.flowVersion);
  assertLeadPublishable(input.leadStatus);
  const request = input.request;
  // A missing or soft-deleted request is never open: same outcome as a non-open request.
  if (!request || request.deleted === true) throw new ServiceRequestNotEligibleForLeadError("REQUEST_NOT_OPEN");
  assertServiceRequestEligibleForLead(request);
}

export interface LeadMarketplaceReadinessInput extends LeadAvailabilityInput {
  publication: unknown;
}

/**
 * A published Lead is marketplace-ready only if it is available per the M130
 * policy (`isLeadAvailableForMarketplace` — the single definition of "open")
 * AND carries a complete publication snapshot. Consumers (M134 feed, M135
 * purchase) use this instead of trusting `status === PUBLISHED`. A legacy M124
 * Lead published before this module has no snapshot and is NOT ready.
 */
export function isLeadMarketplaceReady(input: LeadMarketplaceReadinessInput): boolean {
  return isLeadAvailableForMarketplace(input) && isLeadPublicationSnapshotComplete(input.publication);
}
