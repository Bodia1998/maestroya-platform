import { DomainError } from "@/domain/errors/domain-error";
import { parseScaledDecimal } from "@/domain/services/fixed-point-decimal";
import { isValidJobValueEstimationConfig, type JobValueEstimationConfig } from "@/domain/services/job-value-estimation";
import { isLeadPricingConfidence, isValidLeadPricingConfig, type LeadPricingConfig } from "@/domain/services/lead-pricing";
import { LEAD_PURCHASE_CURRENCY } from "@/domain/services/lead-purchase";

/**
 * Module 132 — LEAD_V1 production pricing configuration CONTRACT. Pure, no I/O.
 *
 * The Module 128 engine and the Module 129 estimator already consume explicit,
 * data-only configurations. What was missing was a boundary that decides
 * whether a configuration may be used in production. This file defines:
 *
 *   - the single bundle the production composition consumes (`LeadPricingProductionConfig`:
 *     one version identity + the estimator config + the lead-pricing config);
 *   - `validateLeadPricingProductionConfig`, which classifies any candidate as
 *     VALID / INCOMPLETE / INVALID / TEST_ONLY and reports every problem with
 *     its path, so an operator can see exactly what is wrong;
 *   - `LeadPricingConfigurationError`, thrown by composition (fail closed).
 *
 * Nothing here prices anything and nothing is read from the environment or
 * the clock. Monetary and rate values stay decimal STRINGS validated with the
 * shared fixed-point parser (no JS floating point); the engines parse them
 * again into bigint when they run.
 *
 * LEAD_V1 only: this contract is consumed solely by the Lead purchase price
 * provider. It is unrelated to the legacy quote / payment / commission pricing.
 */

export const LEAD_PRICING_CONFIG_PROFILES = ["PILOT_PRODUCTION", "TEST_ONLY"] as const;
export type LeadPricingConfigProfile = (typeof LEAD_PRICING_CONFIG_PROFILES)[number];

/** Everything the production price provider needs, as ONE versioned snapshot. */
export interface LeadPricingProductionConfig {
  /** Operator-selectable identity of this snapshot, e.g. "lead-pricing-pilot-v1". Lower-case slug. */
  configVersion: string;
  /** PILOT_PRODUCTION may run in production; TEST_ONLY never may. */
  profile: LeadPricingConfigProfile;
  /** Must equal the Lead purchase currency (EUR). Currencies are never mixed. */
  currency: typeof LEAD_PURCHASE_CURRENCY;
  /**
   * ServiceCategory slugs the pilot can price. Must equal, exactly, the slugs
   * that have a typical job value (`jobValue.baseValueBySlug`) AND a lead rate
   * (`leadPricing.rateBySlug`): a category is either fully configured or not
   * supported.
   */
  pilotCategorySlugs: readonly string[];
  jobValue: JobValueEstimationConfig;
  /** Its `unsupportedCategorySlugs` lists the categories that are deliberately NOT priceable. */
  leadPricing: LeadPricingConfig;
}

export type LeadPricingConfigIssueCode = "MISSING" | "INVALID";

export interface LeadPricingConfigIssue {
  /** Dotted path of the offending field, e.g. "leadPricing.rateBySlug.pintura". For env selectors, the variable name. */
  path: string;
  code: LeadPricingConfigIssueCode;
  message: string;
}

export type LeadPricingConfigResolution =
  | { status: "VALID"; config: LeadPricingProductionConfig }
  | { status: "INCOMPLETE"; issues: readonly LeadPricingConfigIssue[] }
  | { status: "INVALID"; issues: readonly LeadPricingConfigIssue[] }
  | { status: "TEST_ONLY"; issues: readonly LeadPricingConfigIssue[] };

/** Thrown by the production composition when no valid production configuration exists. Fail closed. */
export class LeadPricingConfigurationError extends DomainError {
  readonly code = "LEAD_PRICING_CONFIGURATION_INVALID";

  constructor(
    readonly status: Exclude<LeadPricingConfigResolution["status"], "VALID">,
    readonly issues: readonly LeadPricingConfigIssue[],
  ) {
    super(`LEAD_V1 pricing configuration is ${status}: ${issues.map((i) => `${i.path} (${i.code}: ${i.message})`).join("; ")}`);
  }
}

const VERSION_PATTERN = /^[a-z0-9][a-z0-9._-]{0,63}$/;
const MAX_FACTOR_FIXED = 10_000_000n; // 10.0 at 6 fraction digits, same bound as the engines
const FIXED_ONE = 1_000_000n;
const MAX_PRICE_CENTS = 9_999_999_999n; // Decimal(10,2), same bound as the engine

const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);

/** Deep-frozen copy: a calculation can never observe a mutation made after validation. */
function freezeDeep<T>(value: T): T {
  if (typeof value === "object" && value !== null) {
    for (const child of Object.values(value)) freezeDeep(child);
    Object.freeze(value);
  }
  return value;
}

class Collector {
  readonly issues: LeadPricingConfigIssue[] = [];
  missing(path: string, message: string) {
    this.issues.push({ path, code: "MISSING", message });
  }
  invalid(path: string, message: string) {
    this.issues.push({ path, code: "INVALID", message });
  }
}

function checkString(c: Collector, obj: Record<string, unknown>, key: string, path: string): string | null {
  const v = obj[key];
  if (v === undefined || v === null) {
    c.missing(path, "required value is missing");
    return null;
  }
  if (typeof v !== "string" || v.trim() === "") {
    c.invalid(path, "must be a non-empty string");
    return null;
  }
  return v;
}

/** Money / rate / factor strings: plain decimal, no sign, no exponent, bounded scale. */
function checkDecimal(c: Collector, raw: unknown, scale: number, path: string, what: string): bigint | null {
  if (raw === undefined || raw === null) {
    c.missing(path, `${what} is missing`);
    return null;
  }
  const parsed = parseScaledDecimal(raw, scale);
  if (parsed === null) {
    c.invalid(path, `${what} must be a plain non-negative decimal string with at most ${scale} fraction digits (received ${JSON.stringify(raw)})`);
  }
  return parsed;
}

function checkSlugMap(c: Collector, raw: unknown, path: string, each: (slug: string, value: unknown) => void): string[] {
  if (raw === undefined || raw === null) {
    c.missing(path, "required map is missing");
    return [];
  }
  if (!isRecord(raw)) {
    c.invalid(path, "must be an object keyed by category slug");
    return [];
  }
  const slugs = Object.keys(raw);
  if (slugs.length === 0) c.missing(path, "must contain at least one category");
  for (const slug of slugs) {
    if (slug.trim() === "") c.invalid(path, "category slug must be non-empty");
    else each(slug, raw[slug]);
  }
  return slugs;
}

function checkUrgency(c: Collector, raw: unknown, path: string) {
  if (raw === undefined || raw === null) return; // optional: missing level = neutral
  if (!isRecord(raw)) {
    c.invalid(path, "must be an object keyed by urgency level");
    return;
  }
  for (const [level, factor] of Object.entries(raw)) {
    const parsed = parseScaledDecimal(factor, 6);
    if (parsed === null || parsed <= 0n || parsed > MAX_FACTOR_FIXED) {
      c.invalid(`${path}.${level}`, `urgency factor must be a decimal in (0, 10] with at most 6 fraction digits (received ${JSON.stringify(factor)})`);
    }
  }
}

function checkSlugList(c: Collector, raw: unknown, path: string, required: boolean): string[] {
  if (raw === undefined || raw === null) {
    if (required) c.missing(path, "required list is missing");
    return [];
  }
  if (!Array.isArray(raw)) {
    c.invalid(path, "must be a list of category slugs");
    return [];
  }
  const out: string[] = [];
  for (const slug of raw) {
    if (typeof slug !== "string" || slug.trim() === "") c.invalid(path, "every entry must be a non-empty string");
    else if (out.includes(slug)) c.invalid(path, `duplicate category slug "${slug}"`);
    else out.push(slug);
  }
  if (required && raw.length === 0) c.missing(path, "must contain at least one category");
  return out;
}

/**
 * Classifies a candidate production configuration. Never throws.
 *
 *  - TEST_ONLY   : a well-formed TEST_ONLY profile (never acceptable here);
 *  - INCOMPLETE  : required values are absent (and nothing else is wrong);
 *  - INVALID     : at least one value is malformed or inconsistent;
 *  - VALID       : returned as a deep-frozen COPY, so later mutation of the
 *                  candidate cannot change a running calculation.
 *
 * `allowTestOnly` exists only for the contract's own tests; production
 * composition never sets it.
 */
export function validateLeadPricingProductionConfig(candidate: unknown, options: { allowTestOnly?: boolean } = {}): LeadPricingConfigResolution {
  const c = new Collector();
  if (candidate === undefined || candidate === null) {
    c.missing("config", "configuration object is missing");
    return { status: "INCOMPLETE", issues: c.issues };
  }
  if (!isRecord(candidate)) {
    c.invalid("config", "configuration must be an object");
    return { status: "INVALID", issues: c.issues };
  }

  // --- identity -----------------------------------------------------------
  const version = checkString(c, candidate, "configVersion", "configVersion");
  if (version !== null && !VERSION_PATTERN.test(version)) c.invalid("configVersion", "must be a lower-case slug (a-z, 0-9, '.', '_', '-'), at most 64 characters");

  const profileRaw = candidate.profile;
  let profile: LeadPricingConfigProfile | null = null;
  if (profileRaw === undefined || profileRaw === null) c.missing("profile", "profile is missing");
  else if (typeof profileRaw !== "string" || !(LEAD_PRICING_CONFIG_PROFILES as readonly string[]).includes(profileRaw)) {
    c.invalid("profile", `must be one of ${LEAD_PRICING_CONFIG_PROFILES.join(", ")}`);
  } else profile = profileRaw as LeadPricingConfigProfile;

  // Currency: the lead price is charged in the Lead purchase currency; anything else is a mismatch.
  const currencyRaw = candidate.currency;
  if (currencyRaw === undefined || currencyRaw === null) c.missing("currency", "currency is missing");
  else if (currencyRaw !== LEAD_PURCHASE_CURRENCY) c.invalid("currency", `currency mismatch: must be ${LEAD_PURCHASE_CURRENCY} (received ${JSON.stringify(currencyRaw)})`);

  const pilot = checkSlugList(c, candidate.pilotCategorySlugs, "pilotCategorySlugs", true);

  // --- job value estimation ------------------------------------------------
  const jv = candidate.jobValue;
  let jvBaseSlugs: string[] = [];
  if (jv === undefined || jv === null) c.missing("jobValue", "job-value estimation configuration is missing");
  else if (!isRecord(jv)) c.invalid("jobValue", "must be an object");
  else {
    checkString(c, jv, "ruleVersion", "jobValue.ruleVersion");
    const ceiling = checkDecimal(c, jv.maximumValue, 2, "jobValue.maximumValue", "job-value ceiling");
    if (ceiling !== null && ceiling <= 0n) c.invalid("jobValue.maximumValue", "job-value ceiling must be greater than 0");
    jvBaseSlugs = checkSlugMap(c, jv.baseValueBySlug, "jobValue.baseValueBySlug", (slug, raw) => {
      const cents = checkDecimal(c, raw, 2, `jobValue.baseValueBySlug.${slug}`, "base job value");
      if (cents !== null && cents <= 0n) c.invalid(`jobValue.baseValueBySlug.${slug}`, "base job value must be greater than 0");
      if (cents !== null && ceiling !== null && cents > ceiling) c.invalid(`jobValue.baseValueBySlug.${slug}`, "base job value exceeds jobValue.maximumValue");
    });
    checkUrgency(c, jv.urgencyFactors, "jobValue.urgencyFactors");
  }

  // --- lead pricing ----------------------------------------------------------
  const lp = candidate.leadPricing;
  let rateSlugs: string[] = [];
  let unsupported: string[] = [];
  if (lp === undefined || lp === null) c.missing("leadPricing", "lead-pricing configuration is missing");
  else if (!isRecord(lp)) c.invalid("leadPricing", "must be an object");
  else {
    const ruleVersion = checkString(c, lp, "ruleVersion", "leadPricing.ruleVersion");
    if (ruleVersion !== null && isRecord(jv) && ruleVersion === jv.ruleVersion) c.invalid("leadPricing.ruleVersion", "must differ from jobValue.ruleVersion (they version different rules)");

    const minCents = checkDecimal(c, lp.minimumPrice, 2, "leadPricing.minimumPrice", "minimum lead price");
    const maxCents = checkDecimal(c, lp.maximumPrice, 2, "leadPricing.maximumPrice", "maximum lead price");
    if (minCents !== null && minCents <= 0n) c.invalid("leadPricing.minimumPrice", "minimum lead price must be greater than 0");
    if (maxCents !== null && maxCents > MAX_PRICE_CENTS) c.invalid("leadPricing.maximumPrice", "maximum lead price exceeds the Decimal(10,2) storage bound");
    if (minCents !== null && maxCents !== null && maxCents < minCents) c.invalid("leadPricing.maximumPrice", "inconsistent bounds: maximum lead price is below the minimum lead price");

    const conf = lp.minimumConfidence;
    if (conf === undefined || conf === null) c.missing("leadPricing.minimumConfidence", "minimum confidence must be set explicitly");
    else if (!isLeadPricingConfidence(conf)) c.invalid("leadPricing.minimumConfidence", "must be LOW, MEDIUM or HIGH");

    rateSlugs = checkSlugMap(c, lp.rateBySlug, "leadPricing.rateBySlug", (slug, raw) => {
      const rate = checkDecimal(c, raw, 6, `leadPricing.rateBySlug.${slug}`, "lead rate");
      if (rate !== null && (rate <= 0n || rate > FIXED_ONE)) c.invalid(`leadPricing.rateBySlug.${slug}`, "lead rate must be greater than 0 and at most 1 (a fraction, e.g. \"0.12\")");
    });
    checkUrgency(c, lp.urgencyFactors, "leadPricing.urgencyFactors");
    unsupported = checkSlugList(c, lp.unsupportedCategorySlugs, "leadPricing.unsupportedCategorySlugs", false);
  }

  // --- cross-checks: a category is fully configured or explicitly not supported --
  if (pilot.length > 0 && jvBaseSlugs.length > 0 && rateSlugs.length > 0) {
    for (const slug of pilot) {
      if (!jvBaseSlugs.includes(slug)) c.invalid(`jobValue.baseValueBySlug.${slug}`, `pilot category "${slug}" has no base job value`);
      if (!rateSlugs.includes(slug)) c.invalid(`leadPricing.rateBySlug.${slug}`, `pilot category "${slug}" has no lead rate`);
    }
    for (const slug of jvBaseSlugs) if (!pilot.includes(slug)) c.invalid(`jobValue.baseValueBySlug.${slug}`, `"${slug}" has a base job value but is not a pilot category`);
    for (const slug of rateSlugs) if (!pilot.includes(slug)) c.invalid(`leadPricing.rateBySlug.${slug}`, `"${slug}" has a lead rate but is not a pilot category`);
  }
  for (const slug of unsupported) {
    if (pilot.includes(slug)) c.invalid("leadPricing.unsupportedCategorySlugs", `"${slug}" is both a pilot category and unsupported`);
  }

  if (c.issues.length === 0) {
    // Last line of defence: the engines' own validators must agree with this contract.
    if (!isValidJobValueEstimationConfig(candidate.jobValue as JobValueEstimationConfig)) c.invalid("jobValue", "rejected by the job-value estimator's own validation");
    if (!isValidLeadPricingConfig(candidate.leadPricing as LeadPricingConfig)) c.invalid("leadPricing", "rejected by the lead-pricing engine's own validation");
  }

  if (c.issues.length > 0) {
    return c.issues.some((i) => i.code === "INVALID") ? { status: "INVALID", issues: c.issues } : { status: "INCOMPLETE", issues: c.issues };
  }
  if (profile === "TEST_ONLY" && !options.allowTestOnly) {
    return { status: "TEST_ONLY", issues: [{ path: "profile", code: "INVALID", message: "a TEST_ONLY configuration can never be used by production composition" }] };
  }

  const snapshot = JSON.parse(JSON.stringify(candidate)) as LeadPricingProductionConfig;
  return { status: "VALID", config: freezeDeep(snapshot) };
}
