import { ValidationError } from "@/domain/errors/domain-error";

/**
 * Module 146 — Professional Billing Identity: pure domain policy (no I/O).
 *
 * WHAT THIS IS. The legal/fiscal identity under which MaestroYa bills a
 * professional for purchased LEAD_V1 lead access (M150 invoices, M151 credit
 * notes, M152 reconciliation consume it). It is deliberately a SEPARATE concept
 * from:
 *   1. account identity (User),
 *   2. professional identity / business verification (M17/M59/M98 —
 *      `ProfessionalProfile.verificationStatus`, Persona, business-registration
 *      document),
 *   3. payment method / provider identity (Stripe customer or PaymentIntent),
 *   4. payout identity (`ProfessionalPayoutAccount`).
 * None of those is evidence that these billing details are correct, and this
 * record is not evidence of any of them.
 *
 * WHAT THIS IS NOT. It computes no tax (M136 owns the 21% lead-fee IVA) and it
 * infers no tax status or exemption from the country. Validation here is
 * SYNTAX/COMPLETENESS only: there is no registry or VIES lookup in the
 * application, so a `VERIFIED` billing identity means "a MaestroYa
 * administrator reviewed these details", never "a tax authority confirmed
 * them". The tax-id check is a conservative, country-agnostic format check
 * (no per-country checksum) — see `normalizeTaxId`.
 *
 * LIFECYCLE (persisted `verificationStatus`, reusing the existing
 * `VerificationStatus` enum; `PENDING` is intentionally not used):
 *
 *   (no row)  --save-->  UNVERIFIED   complete details, awaiting admin review
 *   UNVERIFIED --admin verify-->  VERIFIED
 *   UNVERIFIED | VERIFIED --admin reject--> REJECTED (needs correction)
 *   any status --professional changes a MATERIAL field--> UNVERIFIED
 *
 * Missing information is "no row": the form only accepts complete details, so an
 * incomplete record is unrepresentable. Existing professionals therefore start
 * as MISSING; nothing is backfilled.
 */

export const BILLING_ENTITY_TYPES = ["INDIVIDUAL", "COMPANY"] as const;
export type BillingEntityType = (typeof BILLING_ENTITY_TYPES)[number];

export const BILLING_IDENTITY_PERSISTED_STATUSES = ["UNVERIFIED", "VERIFIED", "REJECTED"] as const;
export type BillingIdentityPersistedStatus = (typeof BILLING_IDENTITY_PERSISTED_STATUSES)[number];

/** Closed, non-sensitive set safe to show to the professional (free-text admin notes are never shown). */
export const BILLING_IDENTITY_REJECTION_REASONS = ["TAX_ID_MISMATCH", "LEGAL_NAME_MISMATCH", "ADDRESS_INVALID", "OTHER"] as const;
export type BillingIdentityRejectionReason = (typeof BILLING_IDENTITY_REJECTION_REASONS)[number];

/** Derived, professional-facing state. `MISSING` has no persisted row. */
export type BillingIdentityState = "MISSING" | "PENDING_REVIEW" | "VERIFIED" | "NEEDS_CORRECTION";

/** The billing fields. EVERY field here is material: changing any of them invalidates verification. */
export interface BillingIdentityDetails {
  entityType: BillingEntityType;
  legalName: string;
  taxId: string;
  /** ISO 3166-1 alpha-2: country of tax registration/residence. */
  taxCountry: string;
  addressLine1: string;
  addressLine2: string | null;
  city: string;
  region: string | null;
  postalCode: string;
  /** ISO 3166-1 alpha-2: country of the billing address. */
  country: string;
}

export const MATERIAL_BILLING_FIELDS = [
  "entityType",
  "legalName",
  "taxId",
  "taxCountry",
  "addressLine1",
  "addressLine2",
  "city",
  "region",
  "postalCode",
  "country",
] as const satisfies readonly (keyof BillingIdentityDetails)[];

export const BILLING_FIELD_LIMITS = {
  legalName: 200,
  addressLine: 200,
  city: 120,
  region: 120,
  postalCode: 20,
  taxIdMin: 4,
  taxIdMax: 20,
} as const;

const CONTROL_CHARS = /[\u0000-\u001F\u007F-\u009F]/g;

/** NFC, strip control characters, collapse whitespace, trim. */
export function normalizeText(value: unknown): string {
  if (typeof value !== "string") return "";
  return value.normalize("NFC").replace(CONTROL_CHARS, " ").replace(/\s+/g, " ").trim();
}

function normalizeOptionalText(value: unknown): string | null {
  const text = normalizeText(value);
  return text === "" ? null : text;
}

/**
 * Conservative tax-id normalisation: uppercase, and drop the separators people
 * type (spaces, dots, hyphens, slashes). A country prefix is NOT stripped or
 * added — the field is stored exactly as the professional's identifier, and
 * `taxCountry` carries the country separately.
 */
export function normalizeTaxId(value: unknown): string {
  if (typeof value !== "string") return "";
  return value.normalize("NFKC").toUpperCase().replace(/[\s.\-/]/g, "");
}

/**
 * SYNTAX check only: 4–20 ASCII letters/digits after normalisation. There is no
 * per-country checksum and no registry lookup, so passing this proves nothing
 * about legal validity (see the module doc comment).
 */
export function isPlausibleTaxId(normalized: string): boolean {
  return (
    normalized.length >= BILLING_FIELD_LIMITS.taxIdMin &&
    normalized.length <= BILLING_FIELD_LIMITS.taxIdMax &&
    /^[A-Z0-9]+$/.test(normalized)
  );
}

export function normalizeCountryCode(value: unknown): string {
  return typeof value === "string" ? value.trim().toUpperCase() : "";
}

export function isCountryCode(value: string): boolean {
  return /^[A-Z]{2}$/.test(value);
}

export function normalizePostalCode(value: unknown): string {
  return normalizeText(value).toUpperCase();
}

export function isPlausiblePostalCode(value: string): boolean {
  return value.length >= 2 && value.length <= BILLING_FIELD_LIMITS.postalCode && /^[A-Z0-9][A-Z0-9 -]*$/.test(value);
}

export type BillingIdentityIssue =
  | "entityType"
  | "legalName"
  | "taxId"
  | "taxCountry"
  | "addressLine1"
  | "addressLine2"
  | "city"
  | "region"
  | "postalCode"
  | "country";

/**
 * Normalises raw (client) values into canonical details. Pure and idempotent:
 * `normalizeBillingIdentityDetails(normalizeBillingIdentityDetails(x)) ===
 * normalizeBillingIdentityDetails(x)`. Does not validate.
 */
export function normalizeBillingIdentityDetails(raw: Record<string, unknown>): BillingIdentityDetails {
  return {
    entityType: raw.entityType as BillingEntityType,
    legalName: normalizeText(raw.legalName),
    taxId: normalizeTaxId(raw.taxId),
    taxCountry: normalizeCountryCode(raw.taxCountry),
    addressLine1: normalizeText(raw.addressLine1),
    addressLine2: normalizeOptionalText(raw.addressLine2),
    city: normalizeText(raw.city),
    region: normalizeOptionalText(raw.region),
    postalCode: normalizePostalCode(raw.postalCode),
    country: normalizeCountryCode(raw.country),
  };
}

/** Completeness + syntax issues of already-normalised details. Empty array = complete and well-formed. */
export function findBillingIdentityIssues(details: BillingIdentityDetails): BillingIdentityIssue[] {
  const issues: BillingIdentityIssue[] = [];
  if (!(BILLING_ENTITY_TYPES as readonly string[]).includes(details.entityType)) issues.push("entityType");
  if (details.legalName === "" || details.legalName.length > BILLING_FIELD_LIMITS.legalName) issues.push("legalName");
  if (!isPlausibleTaxId(details.taxId)) issues.push("taxId");
  if (!isCountryCode(details.taxCountry)) issues.push("taxCountry");
  if (details.addressLine1 === "" || details.addressLine1.length > BILLING_FIELD_LIMITS.addressLine) issues.push("addressLine1");
  if (details.addressLine2 !== null && details.addressLine2.length > BILLING_FIELD_LIMITS.addressLine) issues.push("addressLine2");
  if (details.city === "" || details.city.length > BILLING_FIELD_LIMITS.city) issues.push("city");
  if (details.region !== null && details.region.length > BILLING_FIELD_LIMITS.region) issues.push("region");
  if (!isPlausiblePostalCode(details.postalCode)) issues.push("postalCode");
  if (!isCountryCode(details.country)) issues.push("country");
  return issues;
}

export function isBillingIdentityComplete(details: BillingIdentityDetails): boolean {
  return findBillingIdentityIssues(details).length === 0;
}

/** Normalises and asserts completeness; throws ValidationError (field names only, never values). */
export function assertValidBillingIdentityDetails(raw: Record<string, unknown>): BillingIdentityDetails {
  const details = normalizeBillingIdentityDetails(raw);
  const issues = findBillingIdentityIssues(details);
  if (issues.length > 0) {
    throw new ValidationError(`Invalid billing identity fields: ${issues.join(", ")}.`);
  }
  return details;
}

/** True when ANY material field differs between two canonical detail sets. */
export function hasMaterialBillingChange(previous: BillingIdentityDetails, next: BillingIdentityDetails): boolean {
  return MATERIAL_BILLING_FIELDS.some((field) => previous[field] !== next[field]);
}

export interface BillingIdentityStateInput extends BillingIdentityDetails {
  verificationStatus: string;
}

export interface BillingIdentityReadiness {
  state: BillingIdentityState;
  /** Stored details are complete and well-formed. */
  isComplete: boolean;
  /** An administrator has verified exactly the stored details. */
  isVerified: boolean;
  /**
   * The single predicate later modules (M147 eligibility, M150 invoice) consume:
   * verified AND still complete/well-formed. A purchase gate is NOT implemented
   * by M146 — see docs/MODULE_146_PROFESSIONAL_BILLING_IDENTITY.md.
   */
  billingReady: boolean;
}

/**
 * Derives the professional-facing state. Unknown/legacy persisted statuses fail
 * closed to PENDING_REVIEW (never to VERIFIED).
 */
export function evaluateBillingIdentityReadiness(record: BillingIdentityStateInput | null | undefined): BillingIdentityReadiness {
  if (!record) return { state: "MISSING", isComplete: false, isVerified: false, billingReady: false };
  const isComplete = isBillingIdentityComplete(record);
  if (record.verificationStatus === "VERIFIED") {
    return { state: "VERIFIED", isComplete, isVerified: true, billingReady: isComplete };
  }
  if (record.verificationStatus === "REJECTED") {
    return { state: "NEEDS_CORRECTION", isComplete, isVerified: false, billingReady: false };
  }
  return { state: "PENDING_REVIEW", isComplete, isVerified: false, billingReady: false };
}

/** Last four characters only; never log or display more than this for a tax id outside the owner/admin review views. */
export function maskTaxId(taxId: string): string {
  if (taxId.length <= 4) return "*".repeat(taxId.length);
  return `${"*".repeat(taxId.length - 4)}${taxId.slice(-4)}`;
}

/**
 * Frozen value object for M150 to copy onto an invoice. Only obtainable from a
 * VERIFIED, complete record; carries the `revision` it was taken from so a later
 * edit can never be confused with the snapshotted content.
 */
export interface BillingIdentitySnapshot extends BillingIdentityDetails {
  readonly professionalProfileId: string;
  readonly revision: number;
  readonly verifiedAt: Date;
}

export function toBillingIdentitySnapshot(record: BillingIdentityStateInput & {
  professionalProfileId: string;
  revision: number;
  verifiedAt: Date | null;
}): BillingIdentitySnapshot | null {
  const readiness = evaluateBillingIdentityReadiness(record);
  if (!readiness.billingReady || record.verifiedAt === null) return null;
  const snapshot: BillingIdentitySnapshot = {
    professionalProfileId: record.professionalProfileId,
    revision: record.revision,
    verifiedAt: new Date(record.verifiedAt.getTime()),
    entityType: record.entityType,
    legalName: record.legalName,
    taxId: record.taxId,
    taxCountry: record.taxCountry,
    addressLine1: record.addressLine1,
    addressLine2: record.addressLine2,
    city: record.city,
    region: record.region,
    postalCode: record.postalCode,
    country: record.country,
  };
  return Object.freeze(snapshot);
}
