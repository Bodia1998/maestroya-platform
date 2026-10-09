import { describe, expect, it } from "vitest";

import { ValidationError } from "@/domain/errors/domain-error";
import {
  MATERIAL_BILLING_FIELDS,
  assertValidBillingIdentityDetails,
  evaluateBillingIdentityReadiness,
  findBillingIdentityIssues,
  hasMaterialBillingChange,
  isBillingIdentityComplete,
  isPlausibleTaxId,
  maskTaxId,
  normalizeBillingIdentityDetails,
  normalizeTaxId,
  toBillingIdentitySnapshot,
  type BillingIdentityDetails,
} from "@/domain/services/professional-billing-identity";

import { VALID_BILLING_INPUT } from "../../../test-utils/fake-professional-billing-identity-repository";

const details = (): BillingIdentityDetails => normalizeBillingIdentityDetails({ ...VALID_BILLING_INPUT });

describe("M146 normalisation", () => {
  it("normalises the tax id to uppercase without separators, keeping any country prefix as typed", () => {
    expect(normalizeTaxId(" b-12.345 674 ")).toBe("B12345674");
    expect(normalizeTaxId("es b12345674")).toBe("ESB12345674");
    expect(normalizeTaxId("DE 123/456/78901")).toBe("DE12345678901");
    expect(normalizeTaxId(undefined)).toBe("");
  });

  it("is idempotent", () => {
    const once = normalizeBillingIdentityDetails({ ...VALID_BILLING_INPUT, legalName: "  Acme   \u0000 S.L. ", taxCountry: " es ", postalCode: " 46 700 " });
    const twice = normalizeBillingIdentityDetails({ ...once });
    expect(twice).toEqual(once);
    expect(once.legalName).toBe("Acme S.L.");
    expect(once.taxCountry).toBe("ES");
    expect(once.postalCode).toBe("46 700");
  });

  it("maps blank optional fields to null", () => {
    const n = normalizeBillingIdentityDetails({ ...VALID_BILLING_INPUT, addressLine2: "   ", region: "" });
    expect(n.addressLine2).toBeNull();
    expect(n.region).toBeNull();
  });
});

describe("M146 validation (syntax and completeness only)", () => {
  it("accepts complete details and applies no country-specific checksum or Spain assumption", () => {
    expect(findBillingIdentityIssues(details())).toEqual([]);
    const samples: [string, string, string][] = [["DE", "DE123456789", "DE"], ["FR", "FR12345678901", "FR"], ["PL", "PL1234567890", "PL"], ["US", "123456789", "US"]];
    for (const [taxCountry, taxId, country] of samples) {
      expect(isBillingIdentityComplete({ ...details(), taxCountry, taxId, country })).toBe(true);
    }
    // A syntactically plausible but checksum-invalid Spanish CIF is accepted: no registry/checksum authority exists.
    expect(isPlausibleTaxId("B12345678")).toBe(true);
  });

  it.each([
    ["entityType", { entityType: "PARTNERSHIP" }],
    ["legalName", { legalName: "   " }],
    ["legalName", { legalName: "x".repeat(201) }],
    ["taxId", { taxId: "AB1" }],
    ["taxId", { taxId: "B12345674!!" }],
    ["taxId", { taxId: "B".repeat(21) }],
    ["taxCountry", { taxCountry: "ESP" }],
    ["taxCountry", { taxCountry: "" }],
    ["addressLine1", { addressLine1: "" }],
    ["city", { city: "" }],
    ["postalCode", { postalCode: "" }],
    ["postalCode", { postalCode: "<script>" }],
    ["country", { country: "1A" }],
  ])("reports %s as an issue for %j", (field, patch) => {
    const issues = findBillingIdentityIssues(normalizeBillingIdentityDetails({ ...VALID_BILLING_INPUT, ...patch }));
    expect(issues).toContain(field);
  });

  it("assertValidBillingIdentityDetails throws a ValidationError naming fields, never values", () => {
    try {
      assertValidBillingIdentityDetails({ ...VALID_BILLING_INPUT, taxId: "!!", legalName: "" });
      expect.unreachable();
    } catch (error) {
      expect(error).toBeInstanceOf(ValidationError);
      const message = (error as Error).message;
      expect(message).toContain("taxId");
      expect(message).toContain("legalName");
      expect(message).not.toContain("!!");
    }
  });
});

describe("M146 material change", () => {
  it("treats every billing field as material", () => {
    const base = details();
    const variants: Record<(typeof MATERIAL_BILLING_FIELDS)[number], Partial<BillingIdentityDetails>> = {
      entityType: { entityType: "INDIVIDUAL" },
      legalName: { legalName: "Other S.L." },
      taxId: { taxId: "B87654321" },
      taxCountry: { taxCountry: "PT" },
      addressLine1: { addressLine1: "Another street 1" },
      addressLine2: { addressLine2: "Floor 2" },
      city: { city: "Valencia" },
      region: { region: null },
      postalCode: { postalCode: "46001" },
      country: { country: "PT" },
    };
    for (const field of MATERIAL_BILLING_FIELDS) {
      expect(hasMaterialBillingChange(base, { ...base, ...variants[field] }), field).toBe(true);
    }
    expect(hasMaterialBillingChange(base, { ...base })).toBe(false);
  });
});

describe("M146 readiness and snapshot", () => {
  const row = (verificationStatus: string, extra: Record<string, unknown> = {}) => ({ ...details(), verificationStatus, ...extra });

  it("derives the four professional-facing states", () => {
    expect(evaluateBillingIdentityReadiness(null).state).toBe("MISSING");
    expect(evaluateBillingIdentityReadiness(row("UNVERIFIED")).state).toBe("PENDING_REVIEW");
    expect(evaluateBillingIdentityReadiness(row("REJECTED")).state).toBe("NEEDS_CORRECTION");
    expect(evaluateBillingIdentityReadiness(row("VERIFIED")).state).toBe("VERIFIED");
  });

  it("is billing-ready only when verified AND complete", () => {
    expect(evaluateBillingIdentityReadiness(null).billingReady).toBe(false);
    expect(evaluateBillingIdentityReadiness(row("UNVERIFIED")).billingReady).toBe(false);
    expect(evaluateBillingIdentityReadiness(row("REJECTED")).billingReady).toBe(false);
    expect(evaluateBillingIdentityReadiness(row("VERIFIED")).billingReady).toBe(true);
    expect(evaluateBillingIdentityReadiness(row("VERIFIED", { taxId: "" })).billingReady).toBe(false);
  });

  it("fails closed for unknown or legacy statuses (never VERIFIED)", () => {
    for (const status of ["PENDING", "SOMETHING_ELSE", "", "verified"]) {
      const r = evaluateBillingIdentityReadiness(row(status));
      expect(r.state).toBe("PENDING_REVIEW");
      expect(r.isVerified).toBe(false);
      expect(r.billingReady).toBe(false);
    }
  });

  it("only a verified, complete record yields a frozen snapshot", () => {
    const verifiedAt = new Date("2026-10-12T10:00:00Z");
    const base = { ...details(), professionalProfileId: "p1", revision: 3, verifiedAt };
    expect(toBillingIdentitySnapshot({ ...base, verificationStatus: "UNVERIFIED" })).toBeNull();
    expect(toBillingIdentitySnapshot({ ...base, verificationStatus: "REJECTED", verifiedAt: null })).toBeNull();
    expect(toBillingIdentitySnapshot({ ...base, verificationStatus: "VERIFIED", verifiedAt: null })).toBeNull();
    const snap = toBillingIdentitySnapshot({ ...base, verificationStatus: "VERIFIED" })!;
    expect(snap.revision).toBe(3);
    expect(snap.legalName).toBe(base.legalName);
    expect(Object.isFrozen(snap)).toBe(true);
    verifiedAt.setUTCFullYear(2000);
    expect(snap.verifiedAt.getUTCFullYear()).toBe(2026);
  });

  it("masks all but the last four characters of a tax id", () => {
    expect(maskTaxId("B12345674")).toBe("*****5674");
    expect(maskTaxId("AB1")).toBe("***");
  });
});
