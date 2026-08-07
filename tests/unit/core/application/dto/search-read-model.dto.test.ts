import { describe, expect, it } from "vitest";

import { searchReadModelSchema } from "@/application/dto/search-read-model.dto";

const VALID_CATEGORY_ID = "123e4567-e89b-12d3-a456-426614174000";

describe("searchReadModelSchema", () => {
  it("accepts an empty search (every field optional)", () => {
    expect(searchReadModelSchema.safeParse({}).success).toBe(true);
  });

  it("defaults sortBy, fuzzy, verifiedOnly, page, and pageSize", () => {
    const result = searchReadModelSchema.safeParse({});
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.sortBy).toBe("RELEVANCE");
      expect(result.data.fuzzy).toBe(true);
      expect(result.data.verifiedOnly).toBe(false);
      expect(result.data.page).toBe(1);
      expect(result.data.pageSize).toBe(20);
    }
  });

  it("accepts a fully populated query", () => {
    const result = searchReadModelSchema.safeParse({
      query: "fontanero",
      kinds: ["PROFESSIONAL", "COMPANY"],
      categoryIds: [VALID_CATEGORY_ID],
      city: "Gandia",
      province: "Valencia",
      verifiedOnly: true,
      minRating: 4,
      minReviewCount: 5,
      latitude: 38.9,
      longitude: -0.18,
      radiusKm: 25,
      sortBy: "DISTANCE",
      fuzzy: false,
      page: 2,
      pageSize: 10,
    });
    expect(result.success).toBe(true);
  });

  it("rejects a query text over 100 characters", () => {
    const result = searchReadModelSchema.safeParse({ query: "a".repeat(101) });
    expect(result.success).toBe(false);
  });

  it("rejects a non-UUID category id", () => {
    const result = searchReadModelSchema.safeParse({ categoryIds: ["not-a-uuid"] });
    expect(result.success).toBe(false);
  });

  it("rejects more than 20 category ids", () => {
    const result = searchReadModelSchema.safeParse({
      categoryIds: Array.from({ length: 21 }, () => VALID_CATEGORY_ID),
    });
    expect(result.success).toBe(false);
  });

  it("rejects a radius over 500km", () => {
    const result = searchReadModelSchema.safeParse({ latitude: 1, longitude: 1, radiusKm: 501 });
    expect(result.success).toBe(false);
  });

  it("rejects an out-of-range page or pageSize", () => {
    expect(searchReadModelSchema.safeParse({ page: 0 }).success).toBe(false);
    expect(searchReadModelSchema.safeParse({ pageSize: 51 }).success).toBe(false);
  });
});
