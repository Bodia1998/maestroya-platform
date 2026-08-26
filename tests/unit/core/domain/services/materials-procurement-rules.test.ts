import { describe, expect, it } from "vitest";

import { MaterialsListRequiredError, PricedMaterialsNotAllowedError, ValidationError } from "@/domain/errors/domain-error";
import type { QuoteMaterialInput } from "@/domain/repositories/quote-repository";
import {
  assertNoPricedMaterialsWhenCustomerPurchased,
  assertValidMaterialsList,
  canConfirmMaterialsPurchase,
  canStartJobGivenMaterials,
  isValidMaterialInput,
  requiresCustomerPurchasedMaterials,
} from "@/domain/services/materials-procurement-rules";

const VALID_MATERIAL: QuoteMaterialInput = {
  name: "Bosch Condens 2300iW boiler",
  brand: "Bosch",
  model: "Condens 2300iW",
  quantity: 1,
  notes: null,
};

describe("Module 63 — requiresCustomerPurchasedMaterials", () => {
  it("is false for PROFESSIONAL_SUPPLIED", () => {
    expect(requiresCustomerPurchasedMaterials("PROFESSIONAL_SUPPLIED")).toBe(false);
  });

  it("is true for CUSTOMER_PURCHASED", () => {
    expect(requiresCustomerPurchasedMaterials("CUSTOMER_PURCHASED")).toBe(true);
  });
});

describe("Module 63 — isValidMaterialInput", () => {
  it("accepts a well-formed material", () => {
    expect(isValidMaterialInput(VALID_MATERIAL)).toBe(true);
  });

  it("rejects an empty or whitespace-only name", () => {
    expect(isValidMaterialInput({ ...VALID_MATERIAL, name: "" })).toBe(false);
    expect(isValidMaterialInput({ ...VALID_MATERIAL, name: "   " })).toBe(false);
  });

  it("rejects a zero or negative quantity", () => {
    expect(isValidMaterialInput({ ...VALID_MATERIAL, quantity: 0 })).toBe(false);
    expect(isValidMaterialInput({ ...VALID_MATERIAL, quantity: -1 })).toBe(false);
  });

  it("accepts a fractional quantity", () => {
    expect(isValidMaterialInput({ ...VALID_MATERIAL, quantity: 12.5 })).toBe(true);
  });

  it("rejects a non-finite quantity", () => {
    expect(isValidMaterialInput({ ...VALID_MATERIAL, quantity: Number.NaN })).toBe(false);
    expect(isValidMaterialInput({ ...VALID_MATERIAL, quantity: Number.POSITIVE_INFINITY })).toBe(false);
  });

  it("allows brand/model/notes to be omitted", () => {
    expect(isValidMaterialInput({ name: "Copper pipe", quantity: 22 })).toBe(true);
  });
});

describe("Module 63 — assertValidMaterialsList", () => {
  it("does not throw for PROFESSIONAL_SUPPLIED even with an empty list", () => {
    expect(() => assertValidMaterialsList("PROFESSIONAL_SUPPLIED", [])).not.toThrow();
  });

  it("ignores an accidentally-supplied materials list for PROFESSIONAL_SUPPLIED", () => {
    expect(() => assertValidMaterialsList("PROFESSIONAL_SUPPLIED", [{ ...VALID_MATERIAL, quantity: -1 }])).not.toThrow();
  });

  it("throws MaterialsListRequiredError for CUSTOMER_PURCHASED with an empty list", () => {
    expect(() => assertValidMaterialsList("CUSTOMER_PURCHASED", [])).toThrow(MaterialsListRequiredError);
  });

  it("accepts a well-formed non-empty list for CUSTOMER_PURCHASED", () => {
    expect(() => assertValidMaterialsList("CUSTOMER_PURCHASED", [VALID_MATERIAL])).not.toThrow();
  });

  it("throws for an invalid item within a CUSTOMER_PURCHASED list", () => {
    expect(() =>
      assertValidMaterialsList("CUSTOMER_PURCHASED", [VALID_MATERIAL, { ...VALID_MATERIAL, name: "" }]),
    ).toThrow(ValidationError);
  });

  it("throws when the list exceeds the maximum item count", () => {
    const materials = Array.from({ length: 51 }, () => VALID_MATERIAL);
    expect(() => assertValidMaterialsList("CUSTOMER_PURCHASED", materials)).toThrow(ValidationError);
  });
});

describe("Module 63 — canStartJobGivenMaterials", () => {
  it("is always true for PROFESSIONAL_SUPPLIED regardless of confirmation state", () => {
    expect(canStartJobGivenMaterials("PROFESSIONAL_SUPPLIED", null)).toBe(true);
    expect(canStartJobGivenMaterials("PROFESSIONAL_SUPPLIED", new Date())).toBe(true);
  });

  it("is false for CUSTOMER_PURCHASED until confirmed", () => {
    expect(canStartJobGivenMaterials("CUSTOMER_PURCHASED", null)).toBe(false);
  });

  it("is true for CUSTOMER_PURCHASED once confirmed", () => {
    expect(canStartJobGivenMaterials("CUSTOMER_PURCHASED", new Date())).toBe(true);
  });
});

describe("Module 63 — canConfirmMaterialsPurchase", () => {
  it("is false for PROFESSIONAL_SUPPLIED — nothing to confirm", () => {
    expect(canConfirmMaterialsPurchase("PROFESSIONAL_SUPPLIED", null)).toBe(false);
  });

  it("is true for CUSTOMER_PURCHASED not yet confirmed", () => {
    expect(canConfirmMaterialsPurchase("CUSTOMER_PURCHASED", null)).toBe(true);
  });

  it("is false for CUSTOMER_PURCHASED already confirmed — no double-confirm", () => {
    expect(canConfirmMaterialsPurchase("CUSTOMER_PURCHASED", new Date())).toBe(false);
  });
});

describe("Module 78 audit finding — assertNoPricedMaterialsWhenCustomerPurchased", () => {
  it("does not throw for PROFESSIONAL_SUPPLIED with a priced MATERIALS item", () => {
    expect(() =>
      assertNoPricedMaterialsWhenCustomerPurchased("PROFESSIONAL_SUPPLIED", [
        { category: "LABOR", unitPrice: 50 },
        { category: "MATERIALS", unitPrice: 200 },
      ]),
    ).not.toThrow();
  });

  it("throws PricedMaterialsNotAllowedError for CUSTOMER_PURCHASED with a priced MATERIALS item", () => {
    expect(() =>
      assertNoPricedMaterialsWhenCustomerPurchased("CUSTOMER_PURCHASED", [
        { category: "LABOR", unitPrice: 50 },
        { category: "MATERIALS", unitPrice: 200 },
      ]),
    ).toThrow(PricedMaterialsNotAllowedError);
  });

  it("does not throw for CUSTOMER_PURCHASED with an unpriced (zero-amount) MATERIALS item", () => {
    expect(() =>
      assertNoPricedMaterialsWhenCustomerPurchased("CUSTOMER_PURCHASED", [
        { category: "LABOR", unitPrice: 50 },
        { category: "MATERIALS", unitPrice: 0 },
      ]),
    ).not.toThrow();
  });

  it("does not throw for CUSTOMER_PURCHASED with no MATERIALS items at all", () => {
    expect(() =>
      assertNoPricedMaterialsWhenCustomerPurchased("CUSTOMER_PURCHASED", [{ category: "LABOR", unitPrice: 50 }]),
    ).not.toThrow();
  });

  it("does not throw for CUSTOMER_PURCHASED with an empty items list", () => {
    expect(() => assertNoPricedMaterialsWhenCustomerPurchased("CUSTOMER_PURCHASED", [])).not.toThrow();
  });

  it("treats an item with no category as LABOR (defaults do not accidentally trigger the rule)", () => {
    expect(() =>
      assertNoPricedMaterialsWhenCustomerPurchased("CUSTOMER_PURCHASED", [{ unitPrice: 50 }]),
    ).not.toThrow();
  });
});
