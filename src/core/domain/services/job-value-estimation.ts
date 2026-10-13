import { formatScaledDecimal, parseScaledDecimal } from "@/domain/services/fixed-point-decimal";
import { LEAD_FLOW_VERSION } from "@/domain/services/lead";

/**
 * Module 129 — Job Value Estimation (V1). Pure, deterministic, no I/O.
 *
 * Answers ONE question: "approximately what is this job/service opportunity
 * worth?" It is NOT the Lead Pricing Engine (Module 128), which decides what a
 * professional pays for ACCESS to the lead and merely consumes this result.
 *
 *   estimatedServiceValue = baseServiceValue x scope x urgency x complexity
 *
 * Three different money concepts stay strictly apart:
 *   - customer budget (budgetMin/budgetMax)  -> NEVER an input of this module;
 *   - estimatedServiceValue                   -> produced here;
 *   - leadPrice                               -> produced by Module 128.
 * The context type has no budget field, so the budget cannot leak in.
 *
 * Honest inputs only. The ServiceRequest today carries NO structured scope
 * (no quantity / size / questionnaire answers), no structured complexity, and
 * free text is never parsed. Therefore `scope` and `complexity` are fixed
 * neutral 1.0, and the only varying input is `urgency` (neutral by default).
 * Because nothing describes the scope of the job, an estimate can never be
 * more than LOW confidence in V1 unless the business explicitly configures a
 * job-type-level (exact subcategory) base value, which earns MEDIUM.
 *
 * Module 163 (Estimation v2) adds ONE optional input, `structuredScope`: scope
 * and complexity factors derived on the server from VALIDATED questionnaire
 * answers (domain/services/lead-scope-questionnaire.ts). When absent, the
 * result is byte-for-byte what V1 produced. When present, the factors replace
 * the neutral 1.0 scope/complexity. Structured scope refines the NUMBER only:
 * it never raises CONFIDENCE. Complete answers prove the form was filled in,
 * not that the estimate is accurate, and the policy that would earn HIGH
 * (which evidence, which calibration) is decision D4, which is not approved.
 * Until it is, confidence is derived exactly as before M163 (MEDIUM for an
 * exact job-type entry, otherwise LOW) and HIGH is never produced. The base
 * value, the ceiling and the fail-closed rules below are unchanged, and a
 * factor above 10.0 is rejected. The customer's stated budget is still not an
 * input.
 *
 * Fail closed: anything not safely estimable is UNAVAILABLE / INVALID_INPUT,
 * never 0, never a minimum, never the customer's budget. Large-project
 * categories are simply left unconfigured, and a computed value above the
 * configured ceiling is UNAVAILABLE (not clamped).
 *
 * Money: no JS floating point. Amounts are integer cents (bigint), factors are
 * fixed-point with 6 fraction digits (bigint); the product is exact and
 * rounded ONCE, half-up, to whole cents. No tax (IVA) is applied here.
 */

export const JOB_VALUE_ESTIMATION_STATUSES = ["ESTIMATED", "UNAVAILABLE", "INVALID_INPUT"] as const;
export type JobValueEstimationStatus = (typeof JOB_VALUE_ESTIMATION_STATUSES)[number];

export const JOB_VALUE_CONFIDENCES = ["LOW", "MEDIUM", "HIGH"] as const;
export type JobValueConfidence = (typeof JOB_VALUE_CONFIDENCES)[number];

export const JOB_VALUE_CURRENCY = "EUR" as const;

export type JobValueUnavailableReason =
  | "NOT_LEAD_V1"
  | "CATEGORY_MISSING"
  | "CATEGORY_NOT_CONFIGURED"
  | "VALUE_EXCEEDS_CEILING"
  | "INVALID_CATEGORY"
  | "INVALID_SCOPE"
  | "INVALID_CONFIGURATION";

/** Estimation-only input. No budget, customer id, contact, address, coordinates or free text. */
export interface JobValueEstimationContext {
  /** Must be LEAD_V1; anything else fails closed. */
  flowVersion: string | null | undefined;
  /** ServiceCategory.slug of the request's category (may itself be a child). */
  categorySlug: string | null;
  /** Slug of that category's parent, when it is a subcategory. */
  parentCategorySlug: string | null;
  /** RequestUrgency of the request, when known. */
  urgency: string | null;
  /**
   * Module 163 — optional, server-derived (never raw client input). Absent / null = no structured scope: V1 behaviour.
   */
  structuredScope?: JobValueStructuredScope | null;
}

/** Factors already derived from validated questionnaire answers. Fixed-point decimal strings, "1.0" = neutral. */
export interface JobValueStructuredScope {
  /** Questionnaire version the answers were validated against; stored in the result for reproducibility. */
  questionnaireVersion: string;
  scopeFactor: string;
  complexityFactor: string;
}

/** Explicit, versioned, data-only configuration. */
export interface JobValueEstimationConfig {
  /** Stable identifier stored in every result (audit/debug). */
  ruleVersion: string;
  /** Typical job value (EUR, max 2 decimals) by ServiceCategory slug. An exact entry for the request's own (sub)category wins over its parent's. */
  baseValueBySlug: Readonly<Record<string, string>>;
  /** Urgency factors ("1.0" = neutral). Missing/unknown level = neutral. */
  urgencyFactors: Readonly<Partial<Record<string, string>>>;
  /** Hard ceiling (EUR). A computed value above it is UNAVAILABLE, never clamped. */
  maximumValue: string;
}

export interface JobValueFactors {
  scope: string;
  urgency: string;
  complexity: string;
}

export interface EstimatedJobValue {
  status: "ESTIMATED";
  /** EUR, exactly 2 decimals, no tax treatment. */
  estimatedServiceValue: string;
  currency: typeof JOB_VALUE_CURRENCY;
  confidence: JobValueConfidence;
  baseValue: string;
  /** Which config entry matched: the request's own category or its parent. */
  baseValueSource: "CATEGORY" | "PARENT_CATEGORY";
  factors: JobValueFactors;
  ruleVersion: string;
  /** Module 163 — present only when structured scope was used. */
  scopeQuestionnaireVersion?: string;
}

export interface UnavailableJobValue {
  status: "UNAVAILABLE" | "INVALID_INPUT";
  reason: JobValueUnavailableReason;
  ruleVersion: string | null;
}

export type JobValueEstimationResult = EstimatedJobValue | UnavailableJobValue;

const FIXED_SCALE_DIGITS = 6;
const FIXED_ONE = 1_000_000n;
const MAX_FACTOR = 10n * FIXED_ONE;
const SCOPE_VERSION_PATTERN = /^[a-z0-9][a-z0-9._-]{0,63}$/;

const parseCents = (s: unknown) => parseScaledDecimal(s, 2);
const parseFixed = (s: unknown) => parseScaledDecimal(s, FIXED_SCALE_DIGITS);

interface CompiledConfig {
  ruleVersion: string;
  bases: Map<string, bigint>;
  urgency: Map<string, bigint>;
  maxCents: bigint;
}

function compileConfig(config: JobValueEstimationConfig): CompiledConfig | null {
  if (!config || typeof config.ruleVersion !== "string" || config.ruleVersion.trim() === "") return null;
  const maxCents = parseCents(config.maximumValue);
  if (maxCents === null || maxCents <= 0n) return null;

  const bases = new Map<string, bigint>();
  for (const [slug, raw] of Object.entries(config.baseValueBySlug ?? {})) {
    const cents = parseCents(raw);
    // A zero/negative/malformed base, or one already above the ceiling, is a broken configuration.
    if (slug === "" || cents === null || cents <= 0n || cents > maxCents) return null;
    bases.set(slug, cents);
  }
  const urgency = new Map<string, bigint>();
  for (const [level, raw] of Object.entries(config.urgencyFactors ?? {})) {
    const factor = parseFixed(raw);
    if (factor === null || factor <= 0n || factor > MAX_FACTOR) return null;
    urgency.set(level, factor);
  }
  return { ruleVersion: config.ruleVersion, bases, urgency, maxCents };
}

/** True when the configuration would be accepted by the estimator. */
export function isValidJobValueEstimationConfig(config: JobValueEstimationConfig): boolean {
  return compileConfig(config) !== null;
}

function fail(status: UnavailableJobValue["status"], reason: JobValueUnavailableReason, ruleVersion: string | null): UnavailableJobValue {
  return { status, reason, ruleVersion };
}

/**
 * Deterministic job-value estimate. Never throws; every problem is an explicit
 * UNAVAILABLE / INVALID_INPUT result (fail closed, never a guessed value).
 */
export function estimateJobValue(context: JobValueEstimationContext, config: JobValueEstimationConfig): JobValueEstimationResult {
  const compiled = compileConfig(config);
  const version = compiled?.ruleVersion ?? null;

  // Legacy / unknown flow: never estimated (LEAD_V1 only).
  if (!context || context.flowVersion !== LEAD_FLOW_VERSION) return fail("UNAVAILABLE", "NOT_LEAD_V1", version);
  if (!compiled) return fail("INVALID_INPUT", "INVALID_CONFIGURATION", null);

  if (context.categorySlug === null || context.categorySlug === undefined || context.categorySlug === "") {
    return fail("UNAVAILABLE", "CATEGORY_MISSING", version);
  }
  if (typeof context.categorySlug !== "string") return fail("INVALID_INPUT", "INVALID_CATEGORY", version);
  const slug = context.categorySlug;
  const parent = typeof context.parentCategorySlug === "string" && context.parentCategorySlug !== "" ? context.parentCategorySlug : null;

  let base = compiled.bases.get(slug);
  let baseValueSource: EstimatedJobValue["baseValueSource"] = "CATEGORY";
  if (base === undefined && parent !== null) {
    base = compiled.bases.get(parent);
    baseValueSource = "PARENT_CATEGORY";
  }
  if (base === undefined) return fail("UNAVAILABLE", "CATEGORY_NOT_CONFIGURED", version);

  const neutral = FIXED_ONE;
  let scopeFactor = neutral;
  let complexityFactor = neutral;
  let scopeQuestionnaireVersion: string | undefined;
  const structured = context.structuredScope;
  if (structured !== undefined && structured !== null) {
    const s = parseFixed(structured?.scopeFactor);
    const c = parseFixed(structured?.complexityFactor);
    const v = structured?.questionnaireVersion;
    // Malformed structured scope is a rejection, never a silent fall-back to neutral.
    if (s === null || c === null || s <= 0n || c <= 0n || s > MAX_FACTOR || c > MAX_FACTOR || typeof v !== "string" || !SCOPE_VERSION_PATTERN.test(v)) {
      return fail("INVALID_INPUT", "INVALID_SCOPE", version);
    }
    scopeFactor = s;
    complexityFactor = c;
    scopeQuestionnaireVersion = v;
  }

  // Confidence reflects input quality, not the ability to compute a number.
  // An exact job-type entry is MEDIUM, a parent-category fallback is LOW.
  // Structured scope deliberately does NOT change this (see header, D4).
  const confidence: JobValueConfidence = baseValueSource === "CATEGORY" && parent !== null ? "MEDIUM" : "LOW";

  const urgencyFactor = (context.urgency !== null && compiled.urgency.get(context.urgency)) || neutral;
  const factors = [scopeFactor, urgencyFactor, complexityFactor] as const;

  // Exact: cents x f1..f3 over 10^(6*3); one half-up rounding to cents.
  const numerator = factors.reduce((acc, f) => acc * f, base);
  const denominator = FIXED_ONE ** 3n;
  const value = (numerator * 2n + denominator) / (2n * denominator);
  if (value <= 0n) return fail("UNAVAILABLE", "INVALID_CONFIGURATION", version);
  if (value > compiled.maxCents) return fail("UNAVAILABLE", "VALUE_EXCEEDS_CEILING", version);

  const fmtFactor = (f: bigint) => formatScaledDecimal(f, FIXED_SCALE_DIGITS, 1);
  return {
    status: "ESTIMATED",
    estimatedServiceValue: formatScaledDecimal(value, 2, 2),
    currency: JOB_VALUE_CURRENCY,
    confidence,
    baseValue: formatScaledDecimal(base, 2, 2),
    baseValueSource,
    factors: { scope: fmtFactor(factors[0]), urgency: fmtFactor(factors[1]), complexity: fmtFactor(factors[2]) },
    ruleVersion: compiled.ruleVersion,
    ...(scopeQuestionnaireVersion !== undefined ? { scopeQuestionnaireVersion } : {}),
  };
}
