import { DomainError } from "@/domain/errors/domain-error";
import { parseScaledDecimal } from "@/domain/services/fixed-point-decimal";
import { LEAD_PURCHASE_CURRENCY } from "@/domain/services/lead-purchase";
import { resolvePricingTerritory } from "@/domain/services/spain-pricing-territory";

/**
 * Module 164 — REGIONAL / CATEGORY CALIBRATION contract. Pure, deterministic, no I/O.
 *
 * A `RegionalCalibrationConfig` is explicit, versioned, data-only configuration that says, for every
 * (category, province) combination the platform is willing to price AUTOMATICALLY, what typical job-value range the owner
 * has approved and on what evidence. It is deliberately NOT a general "default" table:
 *
 *   - A combination that is not listed is NOT_CONFIGURED. It is never priced from another region, another category or a
 *     global default (no silent fallback). It goes to administrator review.
 *   - Every APPROVED entry must carry an approval reference and an evidence record. An entry without them is an INVALID
 *     configuration, not a weaker entry. The configuration refuses to load rather than guess.
 *   - Provinces must be paid-lead territory (decision D1: mainland Spain + Balearic Islands). Listing the Canary Islands,
 *     Ceuta or Melilla is an INVALID configuration.
 *
 * Decision D3 (lead price) is enforced HERE, as a contract on any configuration, so that no data file can quietly loosen it:
 *   base price = 10% of the AVERAGE estimated job value; floor EUR 20.00; ceiling EUR 400.00 (both excluding IVA).
 *   A configuration may NARROW the floor/ceiling band but can never widen it, and `baseRate` must be exactly 0.10.
 *
 * The supply multiplier is OFF unless a configuration carries an approved, bounded, deterministic table. Nothing here derives
 * a multiplier from "how many professionals there are": that policy is not approved (see MODULE_164 doc).
 *
 * Money and rates are decimal STRINGS parsed with the shared fixed-point parser. No floating point.
 */

// --- D3 policy constants (the confirmed lead-price rule) ---------------------------------------------------------------
export const LEAD_PRICE_FLOOR = "20.00";
export const LEAD_PRICE_CEILING = "400.00";
export const LEAD_PRICE_BASE_RATE = "0.10";

export const REGIONAL_ENTRY_STATUSES = ["APPROVED", "UNSUPPORTED", "PENDING_EVIDENCE"] as const;
export type RegionalEntryStatus = (typeof REGIONAL_ENTRY_STATUSES)[number];

/**
 * OWNER_ASSUMPTION  an owner estimate with no external data behind it.
 * MARKET_REFERENCE  an external, citable price reference (price list, quotes sample, study).
 * HISTORICAL_OUTCOMES  the range was derived from recorded actual job values (needs a sample size).
 */
export const CALIBRATION_EVIDENCE_KINDS = ["OWNER_ASSUMPTION", "MARKET_REFERENCE", "HISTORICAL_OUTCOMES"] as const;
export type CalibrationEvidenceKind = (typeof CALIBRATION_EVIDENCE_KINDS)[number];

export interface CalibrationEvidence {
  kind: CalibrationEvidenceKind;
  /** Where the evidence can be found (document id, study name, dataset id). Never empty for an APPROVED entry. */
  reference: string;
  /** Required (positive integer) for HISTORICAL_OUTCOMES. */
  sampleSize?: number;
}

/** A RECORDED hold-out validation of this entry. Absent unless someone actually ran one; it is never defaulted. */
export interface CalibrationValidation {
  method: "HOLDOUT";
  /** Observations in the held-out set. */
  sampleSize: number;
  /** Relative-error tolerance the result was measured with, e.g. "0.20". */
  toleranceRelative: string;
  /** Share of held-out estimates inside the tolerance, e.g. "0.91". */
  withinToleranceRate: string;
  /** Dataset / report identifier, so the number can be reproduced. */
  datasetReference: string;
}

export interface RegionalCalibrationEntry {
  categorySlug: string;
  /** Explicit province codes ("07", "28", ...). No wildcard: every covered province is listed. */
  provinceCodes: readonly string[];
  status: RegionalEntryStatus;
  /** APPROVED only: typical job-value range in EUR, max 2 decimals, low <= high. */
  jobValueLow?: string;
  jobValueHigh?: string;
  /** APPROVED only: who/what approved this entry. */
  approvalRef?: string;
  evidence?: CalibrationEvidence;
  validation?: CalibrationValidation;
}

export type SupplyMultiplierPolicy =
  | { status: "DISABLED" }
  | {
      status: "ENABLED";
      approvalRef: string;
      /** Approved bounds of the factor, fixed-point strings ("0.90", "1.25"). */
      minimum: string;
      maximum: string;
      /** Explicit factor per province code. A province absent from the table gets the neutral factor 1.0. */
      factorByProvinceCode: Readonly<Record<string, string>>;
    };

export interface ConfidencePolicy {
  /** Integer 1..10: the lowest score that may be published automatically. */
  autoPublishMinimumScore: number;
  /** Range spread = (high - low) / (high + low). At or below this: "narrow". */
  narrowSpreadMax: string;
  /** At or below this (and above narrow): "moderate". Above: "wide". */
  moderateSpreadMax: string;
  /** Validation only counts when its sample is at least this large. */
  minimumValidationSample: number;
  /** ... and its within-tolerance rate is at least this (the target to be demonstrated, e.g. "0.90"). */
  minimumValidationRate: string;
}

export interface RegionalCalibrationConfig {
  /** Operator-selectable identity, lower-case slug, e.g. "lead-regional-pricing-v1". Stored on every priced lead. */
  calibrationVersion: string;
  /** Stored as `jobValueRuleVersion` / `pricingRuleVersion` of the publication snapshot. */
  jobValueRuleVersion: string;
  pricingRuleVersion: string;
  currency: typeof LEAD_PURCHASE_CURRENCY;
  /** Must be exactly LEAD_PRICE_BASE_RATE (decision D3). */
  baseRate: string;
  minimumPrice: string;
  maximumPrice: string;
  /** Hard ceiling of an estimated job value. Above it the request is not priceable here (large project), never clamped. */
  maximumJobValue: string;
  /** Categories deliberately NOT priceable (e.g. "reformas"), in every province. Wins over any entry. */
  unsupportedCategorySlugs: readonly string[];
  confidencePolicy: ConfidencePolicy;
  supplyMultiplier: SupplyMultiplierPolicy;
  entries: readonly RegionalCalibrationEntry[];
}

export interface RegionalCalibrationIssue {
  path: string;
  code: "MISSING" | "INVALID";
  message: string;
}

export type RegionalCalibrationResolution =
  | { status: "VALID"; config: RegionalCalibrationConfig }
  | { status: "INCOMPLETE"; issues: readonly RegionalCalibrationIssue[] }
  | { status: "INVALID"; issues: readonly RegionalCalibrationIssue[] };

/** Thrown when a caller insists on a valid configuration and there is none. */
export class RegionalCalibrationConfigurationError extends DomainError {
  readonly code = "LEAD_REGIONAL_CALIBRATION_INVALID";

  constructor(
    readonly status: "INCOMPLETE" | "INVALID",
    readonly issues: readonly RegionalCalibrationIssue[],
  ) {
    super(`Regional calibration configuration is ${status}: ${issues.map((i) => `${i.path} (${i.code}: ${i.message})`).join("; ")}`);
  }
}

const VERSION_PATTERN = /^[a-z0-9][a-z0-9._-]{0,63}$/;
const SLUG_PATTERN = /^[a-z0-9][a-z0-9-]{0,63}$/;
const FIXED_ONE = 1_000_000n;
const MAX_FACTOR = 10n * FIXED_ONE;
const MAX_MONEY_CENTS = 9_999_999_999n;
const MAX_REFERENCE_LENGTH = 200;

export const NEUTRAL_MARKET_FACTOR = "1.0";

const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);
const reference = (v: unknown): v is string => typeof v === "string" && v.trim() !== "" && v.length <= MAX_REFERENCE_LENGTH;

function freezeDeep<T>(value: T): T {
  if (typeof value === "object" && value !== null) {
    for (const child of Object.values(value)) freezeDeep(child);
    Object.freeze(value);
  }
  return value;
}

class Collector {
  readonly issues: RegionalCalibrationIssue[] = [];
  missing(path: string, message: string) {
    this.issues.push({ path, code: "MISSING", message });
  }
  invalid(path: string, message: string) {
    this.issues.push({ path, code: "INVALID", message });
  }
}

function money(c: Collector, raw: unknown, path: string): bigint | null {
  if (raw === undefined || raw === null) {
    c.missing(path, "required value is missing");
    return null;
  }
  const cents = parseScaledDecimal(raw, 2);
  if (cents === null || cents <= 0n || cents > MAX_MONEY_CENTS) {
    c.invalid(path, "must be a positive decimal with at most 2 fraction digits");
    return null;
  }
  return cents;
}

function fraction(c: Collector, raw: unknown, path: string, { allowZero = false } = {}): bigint | null {
  if (raw === undefined || raw === null) {
    c.missing(path, "required value is missing");
    return null;
  }
  const fixed = parseScaledDecimal(raw, 6);
  if (fixed === null || fixed > FIXED_ONE || (!allowZero && fixed === 0n)) {
    c.invalid(path, "must be a decimal fraction in (0, 1] with at most 6 fraction digits");
    return null;
  }
  return fixed;
}

function validateEntry(c: Collector, entry: unknown, index: number, maxJobValueCents: bigint | null, seen: Set<string>): void {
  const path = `entries[${index}]`;
  if (!isRecord(entry)) {
    c.invalid(path, "must be an object");
    return;
  }
  const slug = entry.categorySlug;
  if (typeof slug !== "string" || !SLUG_PATTERN.test(slug)) c.invalid(`${path}.categorySlug`, "must be a category slug");
  const status = entry.status;
  if (typeof status !== "string" || !(REGIONAL_ENTRY_STATUSES as readonly string[]).includes(status)) c.invalid(`${path}.status`, "unknown status");

  const provinces = entry.provinceCodes;
  if (!Array.isArray(provinces) || provinces.length === 0) {
    c.invalid(`${path}.provinceCodes`, "must list at least one province code explicitly");
  } else {
    for (const code of provinces) {
      const territory = resolvePricingTerritory(code);
      if (territory.status !== "SUPPORTED") {
        c.invalid(`${path}.provinceCodes`, `${JSON.stringify(code)} is not paid-lead territory (decision D1)`);
        continue;
      }
      const key = `${String(slug)}|${territory.provinceCode}`;
      if (seen.has(key)) c.invalid(`${path}.provinceCodes`, `duplicate entry for ${String(slug)} in province ${territory.provinceCode}`);
      seen.add(key);
    }
  }

  if (status === "APPROVED") {
    const low = money(c, entry.jobValueLow, `${path}.jobValueLow`);
    const high = money(c, entry.jobValueHigh, `${path}.jobValueHigh`);
    if (low !== null && high !== null && low > high) c.invalid(`${path}.jobValueLow`, "must not exceed jobValueHigh");
    if (high !== null && maxJobValueCents !== null && high > maxJobValueCents) c.invalid(`${path}.jobValueHigh`, "must not exceed maximumJobValue");
    if (!reference(entry.approvalRef)) c.missing(`${path}.approvalRef`, "an APPROVED entry needs an approval reference");
    const evidence = entry.evidence;
    if (!isRecord(evidence)) {
      c.missing(`${path}.evidence`, "an APPROVED entry needs an evidence record");
    } else {
      if (typeof evidence.kind !== "string" || !(CALIBRATION_EVIDENCE_KINDS as readonly string[]).includes(evidence.kind)) c.invalid(`${path}.evidence.kind`, "unknown evidence kind");
      if (!reference(evidence.reference)) c.missing(`${path}.evidence.reference`, "evidence needs a reference");
      if (evidence.kind === "HISTORICAL_OUTCOMES" && !(Number.isSafeInteger(evidence.sampleSize) && (evidence.sampleSize as number) > 0)) {
        c.invalid(`${path}.evidence.sampleSize`, "HISTORICAL_OUTCOMES evidence needs a positive integer sample size");
      }
    }
  } else if (entry.jobValueLow !== undefined || entry.jobValueHigh !== undefined) {
    // A value on a non-approved entry could be mistaken for an approved range. Refuse it.
    c.invalid(`${path}.jobValueLow`, "only an APPROVED entry may carry a job-value range");
  }

  const validation = entry.validation;
  if (validation !== undefined) {
    if (!isRecord(validation) || validation.method !== "HOLDOUT") {
      c.invalid(`${path}.validation`, "must be a HOLDOUT record");
    } else {
      if (!(Number.isSafeInteger(validation.sampleSize) && (validation.sampleSize as number) > 0)) c.invalid(`${path}.validation.sampleSize`, "must be a positive integer");
      fraction(c, validation.toleranceRelative, `${path}.validation.toleranceRelative`);
      fraction(c, validation.withinToleranceRate, `${path}.validation.withinToleranceRate`, { allowZero: true });
      if (!reference(validation.datasetReference)) c.missing(`${path}.validation.datasetReference`, "a validation needs a dataset reference");
      if (status !== "APPROVED") c.invalid(`${path}.validation`, "only an APPROVED entry may carry a validation");
    }
  }
}

function validateSupply(c: Collector, policy: unknown): void {
  if (!isRecord(policy) || (policy.status !== "DISABLED" && policy.status !== "ENABLED")) {
    c.invalid("supplyMultiplier", "must be { status: DISABLED } or an approved ENABLED table");
    return;
  }
  if (policy.status === "DISABLED") return;
  if (!reference(policy.approvalRef)) c.missing("supplyMultiplier.approvalRef", "an ENABLED supply multiplier needs an approval reference");
  const min = parseScaledDecimal(policy.minimum, 6);
  const max = parseScaledDecimal(policy.maximum, 6);
  if (min === null || max === null || min <= 0n || max > MAX_FACTOR || min > max) {
    c.invalid("supplyMultiplier.minimum", "approved bounds must satisfy 0 < minimum <= maximum <= 10.0");
    return;
  }
  const table = policy.factorByProvinceCode;
  if (!isRecord(table) || Object.keys(table).length === 0) {
    c.invalid("supplyMultiplier.factorByProvinceCode", "an ENABLED supply multiplier needs an explicit table");
    return;
  }
  for (const [code, raw] of Object.entries(table)) {
    if (resolvePricingTerritory(code).status !== "SUPPORTED") c.invalid(`supplyMultiplier.factorByProvinceCode.${code}`, "not a paid-lead province");
    const factor = parseScaledDecimal(raw, 6);
    if (factor === null || factor < min || factor > max) c.invalid(`supplyMultiplier.factorByProvinceCode.${code}`, "outside the approved bounds");
  }
}

/** Classifies a candidate configuration. Never throws. Returns a deep-frozen copy when VALID. */
export function validateRegionalCalibrationConfig(candidate: unknown): RegionalCalibrationResolution {
  const c = new Collector();
  if (!isRecord(candidate)) return { status: "INVALID", issues: [{ path: "", code: "INVALID", message: "configuration must be an object" }] };

  const version = candidate.calibrationVersion;
  if (typeof version !== "string" || !VERSION_PATTERN.test(version)) c.invalid("calibrationVersion", "must be a lower-case version slug");
  for (const key of ["jobValueRuleVersion", "pricingRuleVersion"] as const) {
    const v = candidate[key];
    if (typeof v !== "string" || !VERSION_PATTERN.test(v)) c.invalid(key, "must be a lower-case version slug");
  }
  if (candidate.currency !== LEAD_PURCHASE_CURRENCY) c.invalid("currency", `must be ${LEAD_PURCHASE_CURRENCY}`);

  // D3: base rate is exactly 10%; the price band can only be narrowed.
  const rate = parseScaledDecimal(candidate.baseRate, 6);
  if (rate === null || rate !== parseScaledDecimal(LEAD_PRICE_BASE_RATE, 6)) c.invalid("baseRate", `decision D3 fixes the base rate at ${LEAD_PRICE_BASE_RATE}`);
  const floor = money(c, candidate.minimumPrice, "minimumPrice");
  const ceiling = money(c, candidate.maximumPrice, "maximumPrice");
  const d3Floor = parseScaledDecimal(LEAD_PRICE_FLOOR, 2) as bigint;
  const d3Ceiling = parseScaledDecimal(LEAD_PRICE_CEILING, 2) as bigint;
  if (floor !== null && floor < d3Floor) c.invalid("minimumPrice", `must be at least ${LEAD_PRICE_FLOOR} (decision D3)`);
  if (ceiling !== null && ceiling > d3Ceiling) c.invalid("maximumPrice", `must be at most ${LEAD_PRICE_CEILING} (decision D3)`);
  if (floor !== null && ceiling !== null && floor > ceiling) c.invalid("minimumPrice", "must not exceed maximumPrice");

  const maxJobValue = money(c, candidate.maximumJobValue, "maximumJobValue");

  const unsupported = candidate.unsupportedCategorySlugs;
  if (!Array.isArray(unsupported) || unsupported.some((s) => typeof s !== "string" || !SLUG_PATTERN.test(s))) {
    c.invalid("unsupportedCategorySlugs", "must be a list of category slugs");
  }

  const policy = candidate.confidencePolicy;
  if (!isRecord(policy)) {
    c.missing("confidencePolicy", "required value is missing");
  } else {
    if (!(Number.isSafeInteger(policy.autoPublishMinimumScore) && (policy.autoPublishMinimumScore as number) >= 1 && (policy.autoPublishMinimumScore as number) <= 10)) {
      c.invalid("confidencePolicy.autoPublishMinimumScore", "must be an integer in 1..10");
    }
    const narrow = fraction(c, policy.narrowSpreadMax, "confidencePolicy.narrowSpreadMax");
    const moderate = fraction(c, policy.moderateSpreadMax, "confidencePolicy.moderateSpreadMax");
    if (narrow !== null && moderate !== null && narrow > moderate) c.invalid("confidencePolicy.narrowSpreadMax", "must not exceed moderateSpreadMax");
    if (!(Number.isSafeInteger(policy.minimumValidationSample) && (policy.minimumValidationSample as number) > 0)) {
      c.invalid("confidencePolicy.minimumValidationSample", "must be a positive integer");
    }
    fraction(c, policy.minimumValidationRate, "confidencePolicy.minimumValidationRate");
  }

  validateSupply(c, candidate.supplyMultiplier);

  const entries = candidate.entries;
  if (!Array.isArray(entries)) {
    c.invalid("entries", "must be a list (possibly empty)");
  } else {
    const seen = new Set<string>();
    entries.forEach((entry, index) => validateEntry(c, entry, index, maxJobValue, seen));
    // A category cannot be both globally unsupported and have an entry.
    const unsupportedSet = new Set(Array.isArray(unsupported) ? unsupported : []);
    entries.forEach((entry, index) => {
      if (isRecord(entry) && typeof entry.categorySlug === "string" && unsupportedSet.has(entry.categorySlug)) {
        c.invalid(`entries[${index}].categorySlug`, "is listed as unsupported and cannot also have an entry");
      }
    });
  }

  if (c.issues.length > 0) {
    const onlyMissing = c.issues.every((i) => i.code === "MISSING");
    return { status: onlyMissing ? "INCOMPLETE" : "INVALID", issues: c.issues };
  }
  return { status: "VALID", config: freezeDeep(structuredClone(candidate) as unknown as RegionalCalibrationConfig) };
}

export type CalibrationLookup =
  | { status: "FOUND"; entry: RegionalCalibrationEntry; match: "CATEGORY" | "PARENT_CATEGORY" }
  | { status: "NOT_CONFIGURED" };

/**
 * Own-slug-then-parent lookup (the rule Modules 128/129/142/163 use) restricted to ONE province. The request's own
 * category wins; an explicit entry for it is never overridden by its parent's. There is no lookup across provinces.
 */
export function findCalibrationEntry(
  config: Pick<RegionalCalibrationConfig, "entries">,
  categorySlug: string,
  parentCategorySlug: string | null,
  provinceCode: string,
): CalibrationLookup {
  const covering = (slug: string) => config.entries.find((e) => e.categorySlug === slug && e.provinceCodes.includes(provinceCode));
  const own = covering(categorySlug);
  if (own) return { status: "FOUND", entry: own, match: "CATEGORY" };
  if (parentCategorySlug) {
    const parent = covering(parentCategorySlug);
    if (parent) return { status: "FOUND", entry: parent, match: "PARENT_CATEGORY" };
  }
  return { status: "NOT_CONFIGURED" };
}

/** True when the request's own slug or its parent's is listed as globally unsupported. */
export function isCategoryUnsupported(config: Pick<RegionalCalibrationConfig, "unsupportedCategorySlugs">, categorySlug: string, parentCategorySlug: string | null): boolean {
  return config.unsupportedCategorySlugs.includes(categorySlug) || (parentCategorySlug !== null && config.unsupportedCategorySlugs.includes(parentCategorySlug));
}

/**
 * Deterministic market (supply) factor for a province. DISABLED -> neutral 1.0. ENABLED -> the approved table value for the
 * province, or neutral when the province is absent from the table. The table was validated against the approved bounds when
 * the configuration loaded; the bounds are re-checked here so a hand-built config object cannot bypass them.
 */
export function resolveSupplyMultiplier(
  policy: SupplyMultiplierPolicy,
  provinceCode: string,
): { status: "OK"; factor: string; enabled: boolean } | { status: "INVALID" } {
  if (policy.status === "DISABLED") return { status: "OK", factor: NEUTRAL_MARKET_FACTOR, enabled: false };
  const min = parseScaledDecimal(policy.minimum, 6);
  const max = parseScaledDecimal(policy.maximum, 6);
  if (min === null || max === null || min <= 0n || max > MAX_FACTOR || min > max) return { status: "INVALID" };
  const table = policy.factorByProvinceCode;
  const raw = Object.prototype.hasOwnProperty.call(table, provinceCode) ? table[provinceCode] : undefined;
  if (raw === undefined) return { status: "OK", factor: NEUTRAL_MARKET_FACTOR, enabled: true };
  const factor = parseScaledDecimal(raw, 6);
  if (factor === null || factor < min || factor > max) return { status: "INVALID" };
  return { status: "OK", factor: raw, enabled: true };
}
