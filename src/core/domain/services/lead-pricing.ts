import { DomainError } from "@/domain/errors/domain-error";
import { LEAD_FLOW_VERSION } from "@/domain/services/lead";
import { LEAD_PURCHASE_CURRENCY } from "@/domain/services/lead-purchase";

/**
 * Module 128 — Concrete Lead Pricing Engine (V1): the fee a professional
 * pays MaestroYa for ACCESS to a Lead. Pure, deterministic, no I/O.
 *
 * This is the Lead MONETIZATION engine. It is NOT the Job Pricing Engine: it
 * never estimates what the job is worth. It only consumes an already-known
 * `estimatedServiceValue` (and fails closed when there is none). It never
 * touches what the customer pays the professional, and it is not tax: the
 * result is the platform fee BEFORE any IVA/invoicing treatment (unresolved
 * business/legal decision, see MODULE_128 report).
 *
 *   leadPrice = clamp( estimatedServiceValue x leadRate x complexity x urgency
 *                      x leadQuality x market , minimumPrice, maximumPrice )
 *
 * Only `urgency` has a data source today and its configured table is neutral
 * (1.0) by default; complexity / leadQuality / market are neutral 1.0 until
 * their modules exist. Nothing here fabricates precision.
 *
 * Money: no JS floating point. Amounts are integer cents (bigint); rates and
 * factors are fixed-point with 6 fraction digits (bigint). The product is
 * computed exactly and rounded ONCE, half-up, to whole cents.
 */

export const LEAD_PRICING_STATUSES = ["PRICED", "UNPRICED", "INVALID_INPUT"] as const;
export type LeadPricingStatus = (typeof LEAD_PRICING_STATUSES)[number];

export const LEAD_PRICING_CONFIDENCES = ["LOW", "MEDIUM", "HIGH"] as const;
export type LeadPricingConfidence = (typeof LEAD_PRICING_CONFIDENCES)[number];

const CONFIDENCE_RANK: Readonly<Record<LeadPricingConfidence, number>> = { LOW: 0, MEDIUM: 1, HIGH: 2 };

export function isLeadPricingConfidence(value: unknown): value is LeadPricingConfidence {
  return typeof value === "string" && (LEAD_PRICING_CONFIDENCES as readonly string[]).includes(value);
}

export type LeadPricingFailureReason =
  | "NOT_LEAD_V1"
  | "LEAD_NOT_FOUND"
  | "SERVICE_VALUE_UNAVAILABLE"
  | "CATEGORY_MISSING"
  | "RATE_NOT_CONFIGURED"
  | "CONFIDENCE_TOO_LOW"
  | "INVALID_SERVICE_VALUE"
  | "INVALID_CURRENCY"
  | "INVALID_CONFIDENCE"
  | "INVALID_CONFIGURATION";

/** Pricing-only input. No customer id, contact, street address or coordinates. */
export interface LeadPricingContext {
  /** Must be LEAD_V1; anything else fails closed. */
  flowVersion: string | null | undefined;
  /** ServiceCategory.slug of the request's category (may itself be a child). */
  categorySlug: string | null;
  /** Slug of that category's parent, when it is a subcategory. */
  parentCategorySlug: string | null;
  /** RequestUrgency of the request, when known. */
  urgency: string | null;
  /** Already-estimated value of the professional's service. null = unknown. */
  estimatedServiceValue: {
    /** Plain decimal string, max 2 fraction digits (e.g. "1234.56"). */
    amount: string;
    currency: string;
    confidence: LeadPricingConfidence;
  } | null;
}

/** Explicit, versioned, data-only configuration. */
export interface LeadPricingConfig {
  /** Stable identifier stored in every result (audit/debug). */
  ruleVersion: string;
  /** Lead rate by ServiceCategory slug, as a decimal fraction string ("0.12"). A subcategory slug entry overrides its parent. */
  rateBySlug: Readonly<Record<string, string>>;
  /** Floor and ceiling of the final price (EUR, max 2 decimals). The ceiling is the large-project protection. */
  minimumPrice: string;
  maximumPrice: string;
  /** Urgency factors ("1.0" = neutral). Missing level = neutral. */
  urgencyFactors: Readonly<Partial<Record<string, string>>>;
  /** Results below this confidence are UNPRICED instead of PRICED. */
  minimumConfidence: LeadPricingConfidence;
}

export interface LeadPricingFactors {
  complexity: string;
  urgency: string;
  leadQuality: string;
  market: string;
}

export interface PricedLead {
  status: "PRICED";
  /** Final fee, EUR, exactly 2 decimals, BEFORE any IVA. */
  price: string;
  currency: typeof LEAD_PURCHASE_CURRENCY;
  confidence: LeadPricingConfidence;
  estimatedServiceValue: string;
  rate: string;
  rateSource: "CATEGORY" | "PARENT_CATEGORY";
  factors: LeadPricingFactors;
  /** Price after rounding but before min/max. */
  uncappedPrice: string;
  capApplied: "MINIMUM" | "MAXIMUM" | null;
  ruleVersion: string;
}

export interface UnpricedLead {
  status: "UNPRICED" | "INVALID_INPUT";
  reason: LeadPricingFailureReason;
  ruleVersion: string | null;
}

export type LeadPricingResult = PricedLead | UnpricedLead;

/** Thrown by adapters that must not continue without a price. Internal: callers map it to a fixed public error. */
export class LeadPricingUnavailableError extends DomainError {
  readonly code = "LEAD_PRICING_UNAVAILABLE";

  constructor(
    readonly status: UnpricedLead["status"],
    readonly reason: LeadPricingFailureReason,
  ) {
    super(`Lead price could not be determined (${status}: ${reason}).`);
  }
}

// ---------------------------------------------------------------------------
// Fixed-point helpers (exported for tests; no floating point anywhere)
// ---------------------------------------------------------------------------

const FIXED_SCALE_DIGITS = 6;
const FIXED_ONE = 1_000_000n;
const MAX_FACTOR = 10n * FIXED_ONE;
const MAX_INTEGER_DIGITS = 12;
/** Decimal(10,2) upper bound (LeadPurchase.price) in cents. */
const MAX_PRICE_CENTS = 9_999_999_999n;

/** Parses a plain non-negative decimal string into an integer scaled by 10^scale. Anything else -> null. */
export function parseScaledDecimal(input: unknown, scale: number): bigint | null {
  if (typeof input !== "string") return null;
  const m = /^(\d{1,12})(?:\.(\d+))?$/.exec(input);
  const integerPart = m?.[1];
  if (!m || !integerPart || integerPart.length > MAX_INTEGER_DIGITS) return null;
  const fraction = m[2] ?? "";
  if (fraction.length > scale) return null;
  return BigInt(integerPart + fraction.padEnd(scale, "0"));
}

/** Formats a scaled integer. `minFraction` trailing zeros are kept (2 for money). */
export function formatScaledDecimal(value: bigint, scale: number, minFraction: number): string {
  const divisor = 10n ** BigInt(scale);
  const whole = value / divisor;
  let fraction = (value % divisor).toString().padStart(scale, "0");
  while (fraction.length > minFraction && fraction.endsWith("0")) fraction = fraction.slice(0, -1);
  return fraction === "" ? whole.toString() : `${whole}.${fraction}`;
}

const parseCents = (s: unknown) => parseScaledDecimal(s, 2);
const parseFixed = (s: unknown) => parseScaledDecimal(s, FIXED_SCALE_DIGITS);

interface CompiledConfig {
  ruleVersion: string;
  rates: Map<string, bigint>;
  minCents: bigint;
  maxCents: bigint;
  urgency: Map<string, bigint>;
  minimumConfidence: LeadPricingConfidence;
}

/** Validates + parses configuration. Returns null when it is nonsensical. */
function compileConfig(config: LeadPricingConfig): CompiledConfig | null {
  if (!config || typeof config.ruleVersion !== "string" || config.ruleVersion.trim() === "") return null;
  if (!isLeadPricingConfidence(config.minimumConfidence)) return null;
  const minCents = parseCents(config.minimumPrice);
  const maxCents = parseCents(config.maximumPrice);
  if (minCents === null || maxCents === null || minCents <= 0n || maxCents < minCents) return null;
  if (maxCents > MAX_PRICE_CENTS) return null;

  const rates = new Map<string, bigint>();
  for (const [slug, raw] of Object.entries(config.rateBySlug ?? {})) {
    const rate = parseFixed(raw);
    if (slug === "" || rate === null || rate <= 0n || rate > FIXED_ONE) return null;
    rates.set(slug, rate);
  }
  const urgency = new Map<string, bigint>();
  for (const [level, raw] of Object.entries(config.urgencyFactors ?? {})) {
    const factor = parseFixed(raw);
    if (factor === null || factor <= 0n || factor > MAX_FACTOR) return null;
    urgency.set(level, factor);
  }
  return { ruleVersion: config.ruleVersion, rates, minCents, maxCents, urgency, minimumConfidence: config.minimumConfidence };
}

/** True when the configuration would be accepted by the engine. */
export function isValidLeadPricingConfig(config: LeadPricingConfig): boolean {
  return compileConfig(config) !== null;
}

function fail(status: UnpricedLead["status"], reason: LeadPricingFailureReason, ruleVersion: string | null): UnpricedLead {
  return { status, reason, ruleVersion };
}

/**
 * Deterministic Lead price. Never throws; every problem is an explicit
 * UNPRICED / INVALID_INPUT result (fail closed, never a guessed price).
 */
export function calculateLeadPrice(context: LeadPricingContext, config: LeadPricingConfig): LeadPricingResult {
  const compiled = compileConfig(config);
  const version = compiled?.ruleVersion ?? null;

  // Legacy / unknown flow: never priced (LEAD_V1 only).
  if (!context || context.flowVersion !== LEAD_FLOW_VERSION) return fail("UNPRICED", "NOT_LEAD_V1", version);
  if (!compiled) return fail("INVALID_INPUT", "INVALID_CONFIGURATION", null);

  const value = context.estimatedServiceValue;
  if (value === null || value === undefined) return fail("UNPRICED", "SERVICE_VALUE_UNAVAILABLE", version);
  if (value.currency !== LEAD_PURCHASE_CURRENCY) return fail("INVALID_INPUT", "INVALID_CURRENCY", version);
  if (!isLeadPricingConfidence(value.confidence)) return fail("INVALID_INPUT", "INVALID_CONFIDENCE", version);
  const valueCents = parseCents(value.amount); // rejects negatives, NaN, Infinity, exponents, >2 decimals
  if (valueCents === null || valueCents <= 0n) return fail("INVALID_INPUT", "INVALID_SERVICE_VALUE", version);

  const slug = typeof context.categorySlug === "string" ? context.categorySlug : "";
  if (slug === "") return fail("UNPRICED", "CATEGORY_MISSING", version);
  const parent = typeof context.parentCategorySlug === "string" && context.parentCategorySlug !== "" ? context.parentCategorySlug : null;

  let rate = compiled.rates.get(slug);
  let rateSource: PricedLead["rateSource"] = "CATEGORY";
  if (rate === undefined && parent !== null) {
    rate = compiled.rates.get(parent);
    rateSource = "PARENT_CATEGORY";
  }
  if (rate === undefined) return fail("UNPRICED", "RATE_NOT_CONFIGURED", version);

  // Confidence = the weakest link: the value estimate and how exactly the rate matched.
  const ruleConfidence: LeadPricingConfidence = rateSource === "CATEGORY" ? "HIGH" : "MEDIUM";
  const confidence = CONFIDENCE_RANK[value.confidence] <= CONFIDENCE_RANK[ruleConfidence] ? value.confidence : ruleConfidence;
  if (CONFIDENCE_RANK[confidence] < CONFIDENCE_RANK[compiled.minimumConfidence]) return fail("UNPRICED", "CONFIDENCE_TOO_LOW", version);

  const neutral = FIXED_ONE;
  const urgencyFactor = (context.urgency !== null && compiled.urgency.get(context.urgency)) || neutral;
  const factors = [neutral /* complexity */, urgencyFactor, neutral /* leadQuality */, neutral /* market */] as const;

  // Exact: cents x rate x f1..f4 over 10^(6*5); one half-up rounding to cents.
  const numerator = factors.reduce((acc, f) => acc * f, valueCents * rate);
  const denominator = FIXED_ONE ** 5n;
  const uncapped = (numerator * 2n + denominator) / (2n * denominator);

  let final = uncapped;
  let capApplied: PricedLead["capApplied"] = null;
  if (uncapped < compiled.minCents) {
    final = compiled.minCents;
    capApplied = "MINIMUM";
  } else if (uncapped > compiled.maxCents) {
    final = compiled.maxCents;
    capApplied = "MAXIMUM";
  }

  const fmtFactor = (f: bigint) => formatScaledDecimal(f, FIXED_SCALE_DIGITS, 1);
  return {
    status: "PRICED",
    price: formatScaledDecimal(final, 2, 2),
    currency: LEAD_PURCHASE_CURRENCY,
    confidence,
    estimatedServiceValue: formatScaledDecimal(valueCents, 2, 2),
    rate: formatScaledDecimal(rate, FIXED_SCALE_DIGITS, 2),
    rateSource,
    factors: {
      complexity: fmtFactor(factors[0]),
      urgency: fmtFactor(factors[1]),
      leadQuality: fmtFactor(factors[2]),
      market: fmtFactor(factors[3]),
    },
    uncappedPrice: formatScaledDecimal(uncapped, 2, 2),
    capApplied,
    ruleVersion: compiled.ruleVersion,
  };
}
