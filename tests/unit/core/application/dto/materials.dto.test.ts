import { describe, expect, it } from "vitest";

import { MAX_MATERIALS_ITEMS, createQuoteSchema, quoteMaterialSchema, updateQuoteSchema } from "@/application/dto/quote.dto";

const VALID_ITEM = { description: "Labor", quantity: 2, unitPrice: 50 };
const REQUEST_ID = "123e4567-e89b-12d3-a456-426614174000";
const VALID_MATERIAL = { name: "Bosch Condens 2300iW boiler", brand: "Bosch", quantity: 1 };

function validCreatePayload(overrides: Record<string, unknown> = {}) {
  return {
    serviceRequestId: REQUEST_ID,
    items: [VALID_ITEM],
    ...overrides,
  };
}

describe("Module 63 — quoteMaterialSchema", () => {
  it("accepts a minimal valid material (name + quantity only)", () => {
    expect(quoteMaterialSchema.safeParse({ name: "Copper pipe 22mm", quantity: 22.5 }).success).toBe(true);
  });

  it("accepts a fully-populated material", () => {
    expect(
      quoteMaterialSchema.safeParse({
        name: "Bosch Condens 2300iW boiler",
        brand: "Bosch",
        model: "Condens 2300iW",
        quantity: 1,
        notes: "Wall-mounted, white finish",
      }).success,
    ).toBe(true);
  });

  it("requires a non-empty name", () => {
    expect(quoteMaterialSchema.safeParse({ name: "", quantity: 1 }).success).toBe(false);
  });

  it("rejects a zero or negative quantity", () => {
    expect(quoteMaterialSchema.safeParse({ name: "Ball valve", quantity: 0 }).success).toBe(false);
    expect(quoteMaterialSchema.safeParse({ name: "Ball valve", quantity: -1 }).success).toBe(false);
  });
});

describe("Module 63 — createQuoteSchema materials rule", () => {
  it("accepts a PROFESSIONAL_SUPPLIED quote with no materials list", () => {
    const result = createQuoteSchema.safeParse(
      validCreatePayload({ materialsStrategy: "PROFESSIONAL_SUPPLIED" }),
    );
    expect(result.success).toBe(true);
  });

  it("accepts a quote that doesn't specify materialsStrategy at all (defaults handled downstream)", () => {
    expect(createQuoteSchema.safeParse(validCreatePayload()).success).toBe(true);
  });

  it("rejects a CUSTOMER_PURCHASED quote with an empty materials list", () => {
    const result = createQuoteSchema.safeParse(
      validCreatePayload({ materialsStrategy: "CUSTOMER_PURCHASED", materials: [] }),
    );
    expect(result.success).toBe(false);
  });

  it("rejects a CUSTOMER_PURCHASED quote with no materials field at all", () => {
    const result = createQuoteSchema.safeParse(validCreatePayload({ materialsStrategy: "CUSTOMER_PURCHASED" }));
    expect(result.success).toBe(false);
  });

  it("accepts a CUSTOMER_PURCHASED quote with a non-empty materials list", () => {
    const result = createQuoteSchema.safeParse(
      validCreatePayload({ materialsStrategy: "CUSTOMER_PURCHASED", materials: [VALID_MATERIAL] }),
    );
    expect(result.success).toBe(true);
  });

  it(`rejects more than ${MAX_MATERIALS_ITEMS} materials`, () => {
    const materials = Array.from({ length: MAX_MATERIALS_ITEMS + 1 }, () => VALID_MATERIAL);
    const result = createQuoteSchema.safeParse(
      validCreatePayload({ materialsStrategy: "CUSTOMER_PURCHASED", materials }),
    );
    expect(result.success).toBe(false);
  });

  it("rejects an invalid materialsStrategy value", () => {
    expect(createQuoteSchema.safeParse(validCreatePayload({ materialsStrategy: "SOMETHING_ELSE" })).success).toBe(
      false,
    );
  });
});

describe("Module 63 — updateQuoteSchema materials rule", () => {
  it("applies the same cross-field rule as createQuoteSchema", () => {
    const withoutServiceRequestId = { items: [VALID_ITEM], materialsStrategy: "CUSTOMER_PURCHASED" as const };
    expect(updateQuoteSchema.safeParse(withoutServiceRequestId).success).toBe(false);
    expect(
      updateQuoteSchema.safeParse({ ...withoutServiceRequestId, materials: [VALID_MATERIAL] }).success,
    ).toBe(true);
  });
});
