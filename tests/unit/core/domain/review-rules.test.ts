import { describe, expect, it } from "vitest";

import { MAX_RATING, MIN_RATING, isValidRating, normalizeComment } from "@/domain/services/review-rules";

describe("review-rules", () => {
  describe("isValidRating", () => {
    it("accepts the minimum rating (1)", () => {
      expect(isValidRating(1)).toBe(true);
    });

    it("accepts the maximum rating (5)", () => {
      expect(isValidRating(5)).toBe(true);
    });

    it("accepts every rating in between", () => {
      expect(isValidRating(2)).toBe(true);
      expect(isValidRating(3)).toBe(true);
      expect(isValidRating(4)).toBe(true);
    });

    it("rejects 0", () => {
      expect(isValidRating(0)).toBe(false);
    });

    it("rejects a rating above 5", () => {
      expect(isValidRating(6)).toBe(false);
      expect(isValidRating(100)).toBe(false);
    });

    it("rejects a negative rating", () => {
      expect(isValidRating(-1)).toBe(false);
      expect(isValidRating(-5)).toBe(false);
    });

    it("rejects a non-integer rating", () => {
      expect(isValidRating(3.5)).toBe(false);
      expect(isValidRating(4.9999)).toBe(false);
    });

    it("exposes the bounds it enforces", () => {
      expect(MIN_RATING).toBe(1);
      expect(MAX_RATING).toBe(5);
    });
  });

  describe("normalizeComment", () => {
    it("trims surrounding whitespace", () => {
      expect(normalizeComment("  Great work!  ")).toBe("Great work!");
    });

    it("treats a whitespace-only comment as empty (null)", () => {
      expect(normalizeComment("   ")).toBeNull();
      expect(normalizeComment("\n\t")).toBeNull();
    });

    it("treats an empty string as null", () => {
      expect(normalizeComment("")).toBeNull();
    });

    it("treats null/undefined as null", () => {
      expect(normalizeComment(null)).toBeNull();
      expect(normalizeComment(undefined)).toBeNull();
    });

    it("leaves a normal comment untouched aside from trimming", () => {
      expect(normalizeComment("Fast and professional.")).toBe("Fast and professional.");
    });
  });
});
