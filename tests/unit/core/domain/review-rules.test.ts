import { describe, expect, it } from "vitest";

import {
  MAX_RATING,
  MAX_RESPONSE_LENGTH,
  MIN_RATING,
  REVIEW_EDIT_WINDOW_HOURS,
  emptyRatingDistribution,
  isValidRating,
  isWithinReviewEditWindow,
  normalizeComment,
  normalizeResponse,
} from "@/domain/services/review-rules";

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

  describe("isWithinReviewEditWindow", () => {
    it("accepts a review created just now", () => {
      const now = new Date();
      expect(isWithinReviewEditWindow(now, now)).toBe(true);
    });

    it("accepts a review created just under the window", () => {
      const now = new Date();
      const createdAt = new Date(now.getTime() - (REVIEW_EDIT_WINDOW_HOURS * 60 * 60 * 1000 - 1000));
      expect(isWithinReviewEditWindow(createdAt, now)).toBe(true);
    });

    it("accepts a review created exactly at the boundary", () => {
      const now = new Date();
      const createdAt = new Date(now.getTime() - REVIEW_EDIT_WINDOW_HOURS * 60 * 60 * 1000);
      expect(isWithinReviewEditWindow(createdAt, now)).toBe(true);
    });

    it("rejects a review created just past the window", () => {
      const now = new Date();
      const createdAt = new Date(now.getTime() - (REVIEW_EDIT_WINDOW_HOURS * 60 * 60 * 1000 + 1000));
      expect(isWithinReviewEditWindow(createdAt, now)).toBe(false);
    });

    it("rejects a review with a createdAt in the future relative to now", () => {
      const now = new Date();
      const createdAt = new Date(now.getTime() + 60 * 60 * 1000);
      expect(isWithinReviewEditWindow(createdAt, now)).toBe(false);
    });

    it("exposes the window it enforces", () => {
      expect(REVIEW_EDIT_WINDOW_HOURS).toBe(72);
    });
  });

  describe("normalizeResponse", () => {
    it("trims surrounding whitespace", () => {
      expect(normalizeResponse("  Thanks!  ")).toBe("Thanks!");
    });

    it("treats a whitespace-only response as null", () => {
      expect(normalizeResponse("   ")).toBeNull();
    });

    it("treats an empty string as null", () => {
      expect(normalizeResponse("")).toBeNull();
    });

    it("treats null/undefined as null", () => {
      expect(normalizeResponse(null)).toBeNull();
      expect(normalizeResponse(undefined)).toBeNull();
    });

    it("leaves a normal response untouched aside from trimming", () => {
      expect(normalizeResponse("Thank you for your business!")).toBe("Thank you for your business!");
    });

    it("exposes the max length it expects the DTO boundary to enforce", () => {
      expect(MAX_RESPONSE_LENGTH).toBe(2000);
    });
  });

  describe("emptyRatingDistribution", () => {
    it("returns a zero-filled distribution across the full 1-5 scale", () => {
      expect(emptyRatingDistribution()).toEqual({ 1: 0, 2: 0, 3: 0, 4: 0, 5: 0 });
    });

    it("returns a fresh object on every call (no shared mutable state)", () => {
      const a = emptyRatingDistribution();
      const b = emptyRatingDistribution();
      a[5] = 10;
      expect(b[5]).toBe(0);
    });
  });
});
