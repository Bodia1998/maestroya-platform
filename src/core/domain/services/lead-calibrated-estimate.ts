import { formatScaledDecimal, parseScaledDecimal } from "@/domain/services/fixed-point-decimal";
import { LEAD_FLOW_VERSION } from "@/domain/services/lead";
import {
  CONFIDENCE_COMPONENT_CODES,
  CONFIDENCE_REASON_CODES,
  ESTIMATE_CONFIDENCE_INTERPRETATION,
  ESTIMATE_CONFIDENCE_SCALE,
  confidenceBand,
  scoreEstimateConfidence,
  type ConfidenceComponent,
  type EstimateConfidence,
  type ScoredScope,
} from "@/domain/services/lead-estimate-confidence";
import { calculateLeadPrice, isLeadPricingConfidence, type LeadPricingConfidence, type LeadPricingConfig, type PricedLead } from "@/domain/services/lead-pricing";
import {
  LEAD_PRICE_CEILING,
  LEAD_PRICE_FLOOR,
  REGIONAL_ENTRY_STATUSES,
  findCalibrationEntry,
  isCategoryUnsupported,
  resolveSupplyMultiplier,
  type RegionalCalibrationConfig,
  type RegionalCalibrationEntry,
  type RegionalEntryStatus,
} from "@/domain/services/lead-regional-calibration";
import { LEAD_PURCHASE_CURRENCY } from "@/domain/services/lead-purchase";
import type { LeadScopeProvenance } from "@/domain/services/lead-scope-questionnaire";
import {
  PRICING_TERRITORY_POLICY_VERSION,
  resolvePricingTerritory,
  type LeadPricingRegion,
  type PricingTerritory,
} from "@/domain/services/spain-pricing-territory";

/**
 * Module 164 — CALIBRATED, REGIONAL lead-price DECISION. Pure, deterministic, no I/O, no clock, no randomness.
 *
 * It answers one question for one request: "may this lead be priced AUTOMATICALLY, must a human assess it, or can it not be
 * priced at all?" — and, when it can be priced, what the price is. It builds ON the existing engine (`calculateLeadPrice`,
 * Module 128) and on the Module 163 scope derivation; it is not a second estimator. What it adds is the evidence layer:
 *
 *   1. Flow / category gates                    LEAD_V1 only; globally unsupported categories (e.g. reformas).
 *   2. Territory (decision D1)                  mainland Spain + Balearic Islands only; no fallback between regions.
 *   3. Scope validity                           tampered / unusable stored scope fails closed; contradictory answers -> review.
 *   4. Calibration lookup                       explicit (category, province) entry; absent -> review, UNSUPPORTED -> unpriced.
 *   5. Job-value range -> average               approved range x validated scope factors; above the ceiling is NOT priceable.
 *   6. Confidence score (decision D4)           explainable 0..10; below the configured threshold -> review.
 *   7. Lead price (decision D3)                 10% of the average job value x optional bounded market factor, clamped to the
 *                                               EUR 20.00 .. 400.00 band (excluding IVA — tax is a separate module).
 *
 * Three outcomes, deliberately distinct (never one "status" that conflates them):
 *   AUTO_PRICE        evidence is sufficient; a price and its provenance are returned.
 *   REVIEW_REQUIRED   a human administrator must assess; NO price is produced and none may be published.
 *   UNPRICED          the request cannot be priced here (invalid/tampered data, unsupported territory/category, broken
 *                     configuration, a refusal by the engine). Fail closed.
 *
 * Money: decimal strings, bigint cents, 6-digit fixed-point factors; products are exact and rounded ONCE, half-up.
 * No IVA is applied or assumed here.
 */

// ---------------------------------------------------------------------------
// Vocabulary
// ---------------------------------------------------------------------------

export const REVIEW_REASON_CODES = ["CALIBRATION_MISSING", "CALIBRATION_PENDING_EVIDENCE", "CONFIDENCE_BELOW_THRESHOLD", "CONFLICTING_ANSWERS"] as const;
export type ReviewReasonCode = (typeof REVIEW_REASON_CODES)[number];

export const UNPRICED_REASON_CODES = [
  "NOT_LEAD_V1",
  "CATEGORY_MISSING",
  "CATEGORY_UNSUPPORTED",
  "COMBINATION_UNSUPPORTED",
  "REGION_UNRESOLVED",
  "TERRITORY_UNSUPPORTED",
  "SCOPE_INVALID",
  "VALUE_EXCEEDS_CEILING",
  "SUPPLY_MULTIPLIER_INVALID",
  "REVIEWED_VALUE_INVALID",
  "PRICING_ENGINE_REFUSED",
] as const;
export type UnpricedReasonCode = (typeof UNPRICED_REASON_CODES)[number];

export type CalibratedScopeInput =
  /** The request carries no stored scope. `questionnaireConfigured` tells whether the category even has a questionnaire. */
  | { status: "NONE"; questionnaireConfigured: boolean }
  | { status: "STRUCTURED"; provenance: LeadScopeProvenance; scopeFactor: string; complexityFactor: string }
  /** Stored answers that contradict each other: a human must look. */
  | { status: "CONFLICTING" }
  /** Stored scope that is tampered, invalid, version-mismatched or otherwise unusable: fail closed. */
  | { status: "INVALID" };

export interface CalibratedPricingInput {
  flowVersion: string | null | undefined;
  categorySlug: string | null;
  parentCategorySlug: string | null;
  region: LeadPricingRegion;
  scope: CalibratedScopeInput;
}

export type CalibrationEntryState = RegionalEntryStatus | "NOT_CONFIGURED";

/** Everything needed to reproduce and audit the decision. Persisted (JSON) with the lead snapshot or the review. */
export interface LeadCalibrationProvenance {
  provenanceVersion: 1;
  source: "AUTOMATIC" | "ADMIN_REVIEW";
  calibrationVersion: string;
  territoryPolicyVersion: string;
  provinceCode: string;
  territory: PricingTerritory;
  categorySlug: string;
  categoryMatch: "CATEGORY" | "PARENT_CATEGORY" | null;
  entryState: CalibrationEntryState;
  approvalRef: string | null;
  evidence: { kind: string; reference: string } | null;
  /** Approved range after the validated scope factors, EUR. null when no approved range was used. */
  jobValueRange: { low: string; high: string } | null;
  /** The "average estimated job value" the D3 base price is computed from (the reviewed value for ADMIN_REVIEW). */
  averageJobValue: string | null;
  scopeFactor: string | null;
  complexityFactor: string | null;
  baseRate: string;
  supplyMultiplier: "DISABLED" | "ENABLED";
  marketFactor: string | null;
  uncappedPrice: string | null;
  capApplied: "MINIMUM" | "MAXIMUM" | null;
  price: string | null;
  confidence: {
    score: number;
    maximum: number;
    threshold: number;
    band: LeadPricingConfidence | null;
    components: readonly ConfidenceComponent[];
    interpretation: typeof ESTIMATE_CONFIDENCE_INTERPRETATION;
  };
  reviewReasons: readonly ReviewReasonCode[];
  review: { reviewId: string; reviewedJobValue: string } | null;
}

export type CalibratedPricingDecision =
  | { decision: "AUTO_PRICE"; priced: PricedLead; provenance: LeadCalibrationProvenance }
  | { decision: "REVIEW_REQUIRED"; reasons: readonly ReviewReasonCode[]; provenance: LeadCalibrationProvenance }
  | { decision: "UNPRICED"; reason: UnpricedReasonCode };

// ---------------------------------------------------------------------------
// Fixed-point helpers
// ---------------------------------------------------------------------------

const FIXED_ONE = 1_000_000n;
const MAX_FACTOR = 10n * FIXED_ONE;
const parseCents = (v: unknown) => parseScaledDecimal(v, 2);
const parseFixed = (v: unknown) => parseScaledDecimal(v, 6);

/** cents x f1 x f2, exact, rounded once half-up to cents. */
function scaleCents(cents: bigint, f1: bigint, f2: bigint): bigint {
  const denominator = FIXED_ONE * FIXED_ONE;
  return (cents * f1 * f2 * 2n + denominator) / (2n * denominator);
}

const unpriced = (reason: UnpricedReasonCode): CalibratedPricingDecision => ({ decision: "UNPRICED", reason });

function scoredScope(scope: CalibratedScopeInput): ScoredScope {
  switch (scope.status) {
    case "STRUCTURED":
      return "VALIDATED";
    case "CONFLICTING":
      return "CONFLICTING";
    case "NONE":
      return scope.questionnaireConfigured ? "NOT_PROVIDED" : "QUESTIONNAIRE_NOT_CONFIGURED";
    default:
      return "NOT_PROVIDED";
  }
}

function confidenceSummary(confidence: EstimateConfidence, band: LeadPricingConfidence | null): LeadCalibrationProvenance["confidence"] {
  return {
    score: confidence.score,
    maximum: confidence.maximum,
    threshold: confidence.threshold,
    band,
    components: confidence.components.map((c) => ({ ...c })),
    interpretation: confidence.interpretation,
  };
}

interface Resolved {
  slug: string;
  parent: string | null;
  provinceCode: string;
  territory: PricingTerritory;
}

/** Gates shared by the automatic path and the review pricing path. */
function resolveGates(
  input: Pick<CalibratedPricingInput, "flowVersion" | "categorySlug" | "parentCategorySlug" | "region">,
  config: RegionalCalibrationConfig,
): { ok: true; value: Resolved } | { ok: false; reason: UnpricedReasonCode } {
  if (!input || input.flowVersion !== LEAD_FLOW_VERSION) return { ok: false, reason: "NOT_LEAD_V1" };
  if (typeof input.categorySlug !== "string" || input.categorySlug === "") return { ok: false, reason: "CATEGORY_MISSING" };
  const parent = typeof input.parentCategorySlug === "string" && input.parentCategorySlug !== "" ? input.parentCategorySlug : null;
  if (isCategoryUnsupported(config, input.categorySlug, parent)) return { ok: false, reason: "CATEGORY_UNSUPPORTED" };
  if (!input.region || input.region.status !== "RESOLVED") return { ok: false, reason: "REGION_UNRESOLVED" };
  const territory = resolvePricingTerritory(input.region.provinceCode);
  if (territory.status === "INVALID") return { ok: false, reason: "REGION_UNRESOLVED" };
  if (territory.status === "UNSUPPORTED") return { ok: false, reason: "TERRITORY_UNSUPPORTED" };
  return { ok: true, value: { slug: input.categorySlug, parent, provinceCode: territory.provinceCode, territory: territory.territory } };
}

function engineConfig(config: RegionalCalibrationConfig, categorySlug: string): LeadPricingConfig {
  return {
    ruleVersion: config.pricingRuleVersion,
    rateBySlug: { [categorySlug]: config.baseRate },
    minimumPrice: config.minimumPrice,
    maximumPrice: config.maximumPrice,
    urgencyFactors: {},
    // The numeric confidence gate is applied by this module BEFORE the engine; the engine must not add a second, different one.
    minimumConfidence: "LOW",
  };
}

function baseProvenance(config: RegionalCalibrationConfig, gates: Resolved): Omit<LeadCalibrationProvenance, "source" | "confidence" | "reviewReasons" | "review" | "entryState" | "categoryMatch" | "approvalRef" | "evidence"> {
  return {
    provenanceVersion: 1,
    calibrationVersion: config.calibrationVersion,
    territoryPolicyVersion: PRICING_TERRITORY_POLICY_VERSION,
    provinceCode: gates.provinceCode,
    territory: gates.territory,
    categorySlug: gates.slug,
    jobValueRange: null,
    averageJobValue: null,
    scopeFactor: null,
    complexityFactor: null,
    baseRate: config.baseRate,
    supplyMultiplier: config.supplyMultiplier.status,
    marketFactor: null,
    uncappedPrice: null,
    capApplied: null,
    price: null,
  };
}

/** Runs the shared D3 price step. Returns the engine's PRICED result or a fail-closed reason. */
function priceAverage(
  config: RegionalCalibrationConfig,
  gates: Resolved,
  averageCents: bigint,
  band: LeadPricingConfidence,
): { ok: true; priced: PricedLead; marketFactor: string } | { ok: false; reason: UnpricedReasonCode } {
  const supply = resolveSupplyMultiplier(config.supplyMultiplier, gates.provinceCode);
  if (supply.status !== "OK") return { ok: false, reason: "SUPPLY_MULTIPLIER_INVALID" };
  const result = calculateLeadPrice(
    {
      flowVersion: LEAD_FLOW_VERSION,
      categorySlug: gates.slug,
      parentCategorySlug: gates.parent,
      urgency: null,
      marketFactor: supply.factor,
      estimatedServiceValue: { amount: formatScaledDecimal(averageCents, 2, 2), currency: LEAD_PURCHASE_CURRENCY, confidence: band },
    },
    engineConfig(config, gates.slug),
  );
  if (result.status !== "PRICED") return { ok: false, reason: "PRICING_ENGINE_REFUSED" };
  // Decision D3 is re-asserted on the OUTPUT, whatever the configuration says.
  const price = parseCents(result.price);
  const floor = parseCents(LEAD_PRICE_FLOOR);
  const ceiling = parseCents(LEAD_PRICE_CEILING);
  if (price === null || floor === null || ceiling === null || price < floor || price > ceiling) return { ok: false, reason: "PRICING_ENGINE_REFUSED" };
  return { ok: true, priced: result, marketFactor: supply.factor };
}

// ---------------------------------------------------------------------------
// The decision
// ---------------------------------------------------------------------------

export function decideCalibratedLeadPrice(input: CalibratedPricingInput, config: RegionalCalibrationConfig): CalibratedPricingDecision {
  const gates = resolveGates(input, config);
  if (!gates.ok) return unpriced(gates.reason);
  const g = gates.value;
  if (input.scope.status === "INVALID") return unpriced("SCOPE_INVALID");

  const lookup = findCalibrationEntry(config, g.slug, g.parent, g.provinceCode);
  const entry: RegionalCalibrationEntry | null = lookup.status === "FOUND" ? lookup.entry : null;
  const match = lookup.status === "FOUND" ? lookup.match : null;
  // An explicit UNSUPPORTED combination is final: it is never routed to review, never priced.
  if (entry && entry.status === "UNSUPPORTED") return unpriced("COMBINATION_UNSUPPORTED");

  const confidence = scoreEstimateConfidence({ scope: scoredScope(input.scope), entry, match }, config.confidencePolicy);
  const prov = baseProvenance(config, g);
  const entryState: CalibrationEntryState = entry ? entry.status : "NOT_CONFIGURED";
  const common = {
    ...prov,
    source: "AUTOMATIC" as const,
    categoryMatch: match,
    entryState,
    approvalRef: entry?.approvalRef ?? null,
    evidence: entry?.evidence ? { kind: entry.evidence.kind, reference: entry.evidence.reference } : null,
    review: null,
  };
  const review = (reasons: ReviewReasonCode[]): CalibratedPricingDecision => ({
    decision: "REVIEW_REQUIRED",
    reasons,
    provenance: { ...common, confidence: confidenceSummary(confidence, null), reviewReasons: reasons },
  });

  const reasons: ReviewReasonCode[] = [];
  if (input.scope.status === "CONFLICTING") reasons.push("CONFLICTING_ANSWERS");
  if (!entry) reasons.push("CALIBRATION_MISSING");
  else if (entry.status === "PENDING_EVIDENCE") reasons.push("CALIBRATION_PENDING_EVIDENCE");
  if (reasons.length > 0) return review(reasons);
  if (!entry || entry.status !== "APPROVED") return review(["CALIBRATION_MISSING"]); // unreachable; defensive

  // Approved range x validated scope factors.
  let scopeFactor = FIXED_ONE;
  let complexityFactor = FIXED_ONE;
  if (input.scope.status === "STRUCTURED") {
    const s = parseFixed(input.scope.scopeFactor);
    const c = parseFixed(input.scope.complexityFactor);
    if (s === null || c === null || s <= 0n || c <= 0n || s > MAX_FACTOR || c > MAX_FACTOR) return unpriced("SCOPE_INVALID");
    scopeFactor = s;
    complexityFactor = c;
  }
  const low = parseCents(entry.jobValueLow);
  const high = parseCents(entry.jobValueHigh);
  const ceilingValue = parseCents(config.maximumJobValue);
  if (low === null || high === null || ceilingValue === null || low <= 0n || high < low) return unpriced("PRICING_ENGINE_REFUSED");
  const lowScaled = scaleCents(low, scopeFactor, complexityFactor);
  const highScaled = scaleCents(high, scopeFactor, complexityFactor);
  if (lowScaled <= 0n) return unpriced("PRICING_ENGINE_REFUSED");
  if (highScaled > ceilingValue) return unpriced("VALUE_EXCEEDS_CEILING");
  const average = (lowScaled + highScaled + 1n) / 2n; // half-up of (low + high) / 2

  const withEstimate = {
    ...common,
    jobValueRange: { low: formatScaledDecimal(lowScaled, 2, 2), high: formatScaledDecimal(highScaled, 2, 2) },
    averageJobValue: formatScaledDecimal(average, 2, 2),
    scopeFactor: formatScaledDecimal(scopeFactor, 6, 1),
    complexityFactor: formatScaledDecimal(complexityFactor, 6, 1),
  };

  if (!confidence.meetsThreshold) {
    const reasonsBelow: ReviewReasonCode[] = ["CONFIDENCE_BELOW_THRESHOLD"];
    return {
      decision: "REVIEW_REQUIRED",
      reasons: reasonsBelow,
      provenance: { ...withEstimate, confidence: confidenceSummary(confidence, null), reviewReasons: reasonsBelow },
    };
  }

  const band = confidenceBand(confidence);
  const priced = priceAverage(config, g, average, band);
  if (!priced.ok) return unpriced(priced.reason);
  return {
    decision: "AUTO_PRICE",
    priced: priced.priced,
    provenance: {
      ...withEstimate,
      marketFactor: priced.marketFactor,
      uncappedPrice: priced.priced.uncappedPrice,
      capApplied: priced.priced.capApplied,
      price: priced.priced.price,
      confidence: confidenceSummary(confidence, band),
      reviewReasons: [],
    },
  };
}

// ---------------------------------------------------------------------------
// Administrator-assessed value
// ---------------------------------------------------------------------------

/** Reviews exist only for LEAD_V1 leads (DB-enforced); the review use cases price under this flow, never choose one. */
export const REVIEWED_PRICING_FLOW_VERSION: string = LEAD_FLOW_VERSION;

export interface ReviewedPricingInput {
  flowVersion: string | null | undefined;
  categorySlug: string | null;
  parentCategorySlug: string | null;
  region: LeadPricingRegion;
  /** The average job value the administrator assessed (EUR decimal string, max 2 decimals). */
  reviewedJobValue: unknown;
  reviewId: string;
  reviewReasons: readonly ReviewReasonCode[];
}

export type ReviewedPricingResult =
  | { status: "PRICED"; priced: PricedLead; provenance: LeadCalibrationProvenance }
  | { status: "UNPRICED"; reason: UnpricedReasonCode };

/**
 * Prices an administrator-assessed average job value with the SAME formula, bounds and territory rules as the automatic path.
 * The administrator supplies a VALUE, never a price: the D3 bounds, the base rate and the market factor stay in one place.
 * A reviewed price is never labelled more than LOW confidence — a human assessment does not turn missing calibration into
 * evidence, and the provenance says it is an administrator assessment.
 */
export function priceReviewedJobValue(input: ReviewedPricingInput, config: RegionalCalibrationConfig): ReviewedPricingResult {
  const gates = resolveGates(input, config);
  if (!gates.ok) return { status: "UNPRICED", reason: gates.reason };
  const g = gates.value;
  const value = parseCents(input.reviewedJobValue);
  const ceilingValue = parseCents(config.maximumJobValue);
  if (value === null || value <= 0n) return { status: "UNPRICED", reason: "REVIEWED_VALUE_INVALID" };
  if (ceilingValue === null || value > ceilingValue) return { status: "UNPRICED", reason: "VALUE_EXCEEDS_CEILING" };
  // An explicit UNSUPPORTED combination cannot be priced even by review.
  const lookup = findCalibrationEntry(config, g.slug, g.parent, g.provinceCode);
  if (lookup.status === "FOUND" && lookup.entry.status === "UNSUPPORTED") return { status: "UNPRICED", reason: "COMBINATION_UNSUPPORTED" };

  const priced = priceAverage(config, g, value, "LOW");
  if (!priced.ok) return { status: "UNPRICED", reason: priced.reason };
  const confidence = scoreEstimateConfidence({ scope: "NOT_PROVIDED", entry: null, match: null }, config.confidencePolicy);
  return {
    status: "PRICED",
    priced: priced.priced,
    provenance: {
      ...baseProvenance(config, g),
      source: "ADMIN_REVIEW",
      categoryMatch: lookup.status === "FOUND" ? lookup.match : null,
      entryState: lookup.status === "FOUND" ? lookup.entry.status : "NOT_CONFIGURED",
      approvalRef: null,
      evidence: null,
      averageJobValue: formatScaledDecimal(value, 2, 2),
      marketFactor: priced.marketFactor,
      uncappedPrice: priced.priced.uncappedPrice,
      capApplied: priced.priced.capApplied,
      price: priced.priced.price,
      confidence: confidenceSummary(confidence, "LOW"),
      reviewReasons: [...input.reviewReasons],
      review: { reviewId: input.reviewId, reviewedJobValue: formatScaledDecimal(value, 2, 2) },
    },
  };
}

// ---------------------------------------------------------------------------
// Provenance guard (defence in depth before anything is persisted or read back)
// ---------------------------------------------------------------------------

const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);
const nullableMoney = (v: unknown) => v === null || parseCents(v) !== null;
const nullableFixed = (v: unknown) => v === null || parseFixed(v) !== null;

export function isLeadCalibrationProvenance(value: unknown): value is LeadCalibrationProvenance {
  if (!isRecord(value)) return false;
  const conf = value.confidence;
  if (!isRecord(conf) || !Array.isArray(conf.components)) return false;
  const components = conf.components as unknown[];
  const componentsOk = components.every(
    (c) =>
      isRecord(c) &&
      (CONFIDENCE_COMPONENT_CODES as readonly string[]).includes(String(c.code)) &&
      (CONFIDENCE_REASON_CODES as readonly string[]).includes(String(c.reason)) &&
      Number.isInteger(c.points) &&
      Number.isInteger(c.maximum) &&
      (c.points as number) >= 0 &&
      (c.points as number) <= (c.maximum as number),
  );
  const range = value.jobValueRange;
  return (
    value.provenanceVersion === 1 &&
    (value.source === "AUTOMATIC" || value.source === "ADMIN_REVIEW") &&
    typeof value.calibrationVersion === "string" && value.calibrationVersion !== "" &&
    typeof value.territoryPolicyVersion === "string" &&
    typeof value.provinceCode === "string" && resolvePricingTerritory(value.provinceCode).status === "SUPPORTED" &&
    (value.territory === "MAINLAND_SPAIN" || value.territory === "BALEARIC_ISLANDS") &&
    typeof value.categorySlug === "string" && value.categorySlug !== "" &&
    (value.categoryMatch === null || value.categoryMatch === "CATEGORY" || value.categoryMatch === "PARENT_CATEGORY") &&
    (value.entryState === "NOT_CONFIGURED" || (REGIONAL_ENTRY_STATUSES as readonly string[]).includes(String(value.entryState))) &&
    (range === null || (isRecord(range) && parseCents(range.low) !== null && parseCents(range.high) !== null)) &&
    nullableMoney(value.averageJobValue) &&
    nullableMoney(value.uncappedPrice) &&
    nullableMoney(value.price) &&
    nullableFixed(value.scopeFactor) &&
    nullableFixed(value.complexityFactor) &&
    nullableFixed(value.marketFactor) &&
    parseFixed(value.baseRate) !== null &&
    (value.supplyMultiplier === "DISABLED" || value.supplyMultiplier === "ENABLED") &&
    (value.capApplied === null || value.capApplied === "MINIMUM" || value.capApplied === "MAXIMUM") &&
    Number.isInteger(conf.score) && (conf.score as number) >= 0 && (conf.score as number) <= ESTIMATE_CONFIDENCE_SCALE &&
    conf.maximum === ESTIMATE_CONFIDENCE_SCALE &&
    Number.isInteger(conf.threshold) &&
    (conf.band === null || isLeadPricingConfidence(conf.band)) &&
    conf.interpretation === ESTIMATE_CONFIDENCE_INTERPRETATION &&
    componentsOk &&
    Array.isArray(value.reviewReasons) &&
    (value.reviewReasons as unknown[]).every((r) => (REVIEW_REASON_CODES as readonly string[]).includes(String(r))) &&
    (value.review === null || (isRecord(value.review) && typeof value.review.reviewId === "string" && parseCents(value.review.reviewedJobValue) !== null))
  );
}
