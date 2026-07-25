import { describe, expect, it } from "vitest";

import { searchDirectorySchema } from "@/application/dto/search.dto";

const VALID_CATEGORY_ID = "123e4567-e89b-12d3-a456-426614174000";

describe("searchDirectorySchema", () => {
  it("accepts an empty search (every field optional)", () => {
    const result = searchDirectorySchema.safeParse({});
    expect(result.success).toBe(true);
  });

  it("defaults sortBy, page, and pageSize", () => {
    const result = searchDirectorySchema.safeParse({});
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.sortBy).toBe("RELEVANCE");
      expect(result.data.page).toBe(1);
      expect(result.data.pageSize).toBe(20);
      expect(result.data.verifiedOnly).toBe(false);
    }
  });

  it("accepts a fully populated search", () => {
    const result = searchDirectorySchema.safeParse({
      query: "electrician",
      categoryId: VALID_CATEGORY_ID,
      city: "Gandia",
      province: "Valencia",
      verifiedOnly: true,
      minRating: 4,
      minReviewCount: 5,
      sortBy: "RATING",
      page: 2,
      pageSize: 10,
    });
    expect(result.success).toBe(true);
  });

  it("rejects a non-UUID category id", () => {
    expect(searchDirectorySchema.safeParse({ categoryId: "not-a-uuid" }).success).toBe(false);
  });

  it("rejects a query longer than 100 characters (abuse prevention)", () => {
    const result = searchDirectorySchema.safeParse({ query: "a".repeat(101) });
    expect(result.success).toBe(false);
  });

  it("treats an empty-string query as absent", () => {
    const result = searchDirectorySchema.safeParse({ query: "   " });
    expect(result.success).toBe(true);
    if (result.success) expect(result.data.query).toBeUndefined();
  });

  it("rejects a minRating outside the 1-5 scale", () => {
    expect(searchDirectorySchema.safeParse({ minRating: 0 }).success).toBe(false);
    expect(searchDirectorySchema.safeParse({ minRating: 6 }).success).toBe(false);
  });

  it("rejects a negative minReviewCount", () => {
    expect(searchDirectorySchema.safeParse({ minReviewCount: -1 }).success).toBe(false);
  });

  it("rejects an invalid sortBy value (closed enum, no arbitrary strings)", () => {
    expect(searchDirectorySchema.safeParse({ sortBy: "MOST_EXPENSIVE" }).success).toBe(false);
  });

  it("rejects a pathological pageSize (abuse prevention)", () => {
    expect(searchDirectorySchema.safeParse({ pageSize: 10000 }).success).toBe(false);
  });

  it("rejects a pathological page number", () => {
    expect(searchDirectorySchema.safeParse({ page: 999999 }).success).toBe(false);
  });
});
