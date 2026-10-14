/**
 * Module 164 — paid-lead TERRITORY policy (decision D1). Pure, deterministic, no I/O.
 *
 * Decision D1 (as confirmed by the owner for M164): the MVP paid-lead territory is MAINLAND SPAIN and the BALEARIC
 * ISLANDS. The Canary Islands, Ceuta and Melilla are NOT supported. This file is the single place that knows that rule.
 * Nothing else in the codebase may decide "is this place paid-lead territory".
 *
 * How a place is identified. The first two digits of a Spanish postal code are the province code (01..52), a stable,
 * official numbering. Free-text `Address.province` / `Address.city` are NOT used: they are customer-typed, unnormalised
 * and spelled in several languages. The code, not the text, drives the decision.
 *   35, 38  -> Canary Islands (Las Palmas, Santa Cruz de Tenerife)  UNSUPPORTED
 *   51      -> Ceuta                                                UNSUPPORTED
 *   52      -> Melilla                                              UNSUPPORTED
 *   07      -> Balearic Islands                                     SUPPORTED
 *   01..50 otherwise -> mainland Spain                              SUPPORTED
 *
 * Fail closed. A missing address, a non-Spanish country or a malformed / out-of-range postal code is INVALID, never
 * "assume mainland". An unsupported territory is reported as such (a waitlist may exist elsewhere in the product, but a
 * paid price is never produced from here). There is no fallback from one region to another.
 *
 * Privacy. The pricing layer only ever receives the two-digit province code derived here — never the postal code, the
 * street, the city or coordinates.
 */

export const PRICING_TERRITORY_POLICY_VERSION = "spain-pricing-territory-v1";

export type PricingTerritory = "MAINLAND_SPAIN" | "BALEARIC_ISLANDS";
export type UnsupportedTerritoryReason = "CANARY_ISLANDS" | "CEUTA" | "MELILLA";

const PROVINCE_CODE_PATTERN = /^(0[1-9]|[1-4]\d|5[0-2])$/;
const POSTAL_CODE_PATTERN = /^(0[1-9]|[1-4]\d|5[0-2])\d{3}$/;

const BALEARIC_PROVINCE_CODES: ReadonlySet<string> = new Set(["07"]);
const UNSUPPORTED_PROVINCE_CODES: Readonly<Record<string, UnsupportedTerritoryReason>> = Object.freeze({
  "35": "CANARY_ISLANDS",
  "38": "CANARY_ISLANDS",
  "51": "CEUTA",
  "52": "MELILLA",
});

export function isSpanishProvinceCode(value: unknown): value is string {
  return typeof value === "string" && PROVINCE_CODE_PATTERN.test(value);
}

/** Two-digit province code of a well-formed Spanish postal code, otherwise null. */
export function provinceCodeFromSpanishPostalCode(postalCode: unknown): string | null {
  if (typeof postalCode !== "string") return null;
  const trimmed = postalCode.trim();
  return POSTAL_CODE_PATTERN.test(trimmed) ? trimmed.slice(0, 2) : null;
}

export type PricingTerritoryResolution =
  | { status: "SUPPORTED"; provinceCode: string; territory: PricingTerritory }
  | { status: "UNSUPPORTED"; provinceCode: string; reason: UnsupportedTerritoryReason }
  | { status: "INVALID"; reason: "PROVINCE_CODE_INVALID" };

export function resolvePricingTerritory(provinceCode: unknown): PricingTerritoryResolution {
  if (!isSpanishProvinceCode(provinceCode)) return { status: "INVALID", reason: "PROVINCE_CODE_INVALID" };
  const unsupported = Object.prototype.hasOwnProperty.call(UNSUPPORTED_PROVINCE_CODES, provinceCode)
    ? UNSUPPORTED_PROVINCE_CODES[provinceCode]
    : undefined;
  if (unsupported) return { status: "UNSUPPORTED", provinceCode, reason: unsupported };
  return { status: "SUPPORTED", provinceCode, territory: BALEARIC_PROVINCE_CODES.has(provinceCode) ? "BALEARIC_ISLANDS" : "MAINLAND_SPAIN" };
}

/** What the pricing layer learns about WHERE a request is. Never carries an address, a postal code or coordinates. */
export type LeadPricingRegion =
  | { status: "RESOLVED"; provinceCode: string }
  | { status: "UNKNOWN"; reason: "NO_ADDRESS" | "COUNTRY_NOT_SPAIN" | "POSTAL_CODE_INVALID" };

/** Derives the region from the stored address facts. Used by the persistence adapter so only the province code leaves it. */
export function deriveLeadPricingRegion(address: { country: string | null | undefined; postalCode: string | null | undefined } | null | undefined): LeadPricingRegion {
  if (!address) return { status: "UNKNOWN", reason: "NO_ADDRESS" };
  if (typeof address.country !== "string" || address.country.trim().toUpperCase() !== "ES") return { status: "UNKNOWN", reason: "COUNTRY_NOT_SPAIN" };
  const provinceCode = provinceCodeFromSpanishPostalCode(address.postalCode);
  return provinceCode === null ? { status: "UNKNOWN", reason: "POSTAL_CODE_INVALID" } : { status: "RESOLVED", provinceCode };
}
