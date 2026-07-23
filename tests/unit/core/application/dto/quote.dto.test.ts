import { describe, expect, it } from "vitest";

import {
  MAX_QUOTE_ITEMS,
  MAX_QUOTE_ITEM_DESCRIPTION_LENGTH,
  createQuoteSchema,
  quoteItemSchema,
  updateQuoteSchema,
} from "@/application/dto/quote.dto";

const VALID_ITEM = { description: "Labor", quantity: 2, unitPrice: 50 };
const REQUEST_ID = "123e4567-e89b-12d3-a456-426614174000";

function validCreatePayload(overrides: Record<string, unknown> = {}) {
  return {
    serviceRequestId: REQUEST_ID,
    items: [VALID_ITEM],
    ...overrides,
  };
}

describe("quoteItemSchema", () => {
  it("accepts a valid item", () => {
    expect(quoteItemSchema.safeParse(VALID_ITEM).success).toBe(true);
  });

  it("requires a non-empty description", () => {
    expect(quoteItemSchema.safeParse({ ...VALID_ITEM, description: "" }).success).toBe(false);
  });

  it(`rejects a description longer than ${MAX_QUOTE_ITEM_DESCRIPTION_LENGTH} characters`, () => {
    expect(
      quoteItemSchema.safeParse({
        ...VALID_ITEM,
        description: "a".repeat(MAX_QUOTE_ITEM_DESCRIPTION_LENGTH + 1),
      }).success,
    ).toBe(false);
  });

  it("rejects a zero or negative quantity", () => {
    expect(quoteItemSchema.safeParse({ ...VALID_ITEM, quantity: 0 }).success).toBe(false);
    expect(quoteItemSchema.safeParse({ ...VALID_ITEM, quantity: -1 }).success).toBe(false);
  });

  it("accepts a fractional quantity", () => {
    expect(quoteItemSchema.safeParse({ ...VALID_ITEM, quantity: 1.5 }).success).toBe(true);
  });

  it("rejects a negative unit price", () => {
    expect(quoteItemSchema.safeParse({ ...VALID_ITEM, unitPrice: -1 }).success).toBe(false);
  });

  it("accepts a zero unit price", () => {
    expect(quoteItemSchema.safeParse({ ...VALID_ITEM, unitPrice: 0 }).success).toBe(true);
  });
});

describe("createQuoteSchema", () => {
  it("accepts a valid submission", () => {
    expect(createQuoteSchema.safeParse(validCreatePayload()).success).toBe(true);
  });

  it("requires a valid serviceRequestId", () => {
    expect(createQuoteSchema.safeParse(validCreatePayload({ serviceRequestId: "not-a-uuid" })).success).toBe(
      false,
    );
  });

  it("requires at least one item", () => {
    expect(createQuoteSchema.safeParse(validCreatePayload({ items: [] })).success).toBe(false);
  });

  it(`rejects more than ${MAX_QUOTE_ITEMS} items`, () => {
    const items = Array.from({ length: MAX_QUOTE_ITEMS + 1 }, () => VALID_ITEM);
    expect(createQuoteSchema.safeParse(validCreatePayload({ items })).success).toBe(false);
  });

  it("does not accept a client-supplied totalAmount field as part of the schema shape", () => {
    // totalAmount isn't part of the schema at all — even if a client sends
    // one, parsing strips it (it's simply not in the output type), and the
    // use case never reads it. See money.ts.
    const result = createQuoteSchema.safeParse(validCreatePayload({ totalAmount: 999999 }));
    expect(result.success).toBe(true);
    if (result.success) {
      expect((result.data as Record<string, unknown>).totalAmount).toBeUndefined();
    }
  });

  it("rejects a validUntil date in the past", () => {
    const result = createQuoteSchema.safeParse(
      validCreatePayload({ validUntil: new Date(Date.now() - 86_400_000).toISOString() }),
    );
    expect(result.success).toBe(false);
  });

  it("accepts a validUntil date in the future", () => {
    const result = createQuoteSchema.safeParse(
      validCreatePayload({ validUntil: new Date(Date.now() + 86_400_000).toISOString() }),
    );
    expect(result.success).toBe(true);
  });

  it("rejects notes longer than the max length", () => {
    const result = createQuoteSchema.safeParse(validCreatePayload({ notes: "a".repeat(3001) }));
    expect(result.success).toBe(false);
  });
});

describe("updateQuoteSchema", () => {
  it("accepts a valid submission without a serviceRequestId", () => {
    expect(updateQuoteSchema.safeParse({ items: [VALID_ITEM] }).success).toBe(true);
  });

  it("still requires at least one item", () => {
    expect(updateQuoteSchema.safeParse({ items: [] }).success).toBe(false);
  });
});
