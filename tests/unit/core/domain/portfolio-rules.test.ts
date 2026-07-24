import { describe, expect, it } from "vitest";

import {
  MAX_DESCRIPTION_LENGTH,
  MAX_TITLE_LENGTH,
  MIN_TITLE_LENGTH,
  isValidDescription,
  isValidMediaUrl,
  isValidTitle,
  normalizeOptionalText,
} from "@/domain/services/portfolio-rules";

describe("portfolio-rules", () => {
  describe("isValidTitle", () => {
    it("accepts a title at the minimum length", () => {
      expect(isValidTitle("a".repeat(MIN_TITLE_LENGTH))).toBe(true);
    });

    it("accepts a title at the maximum length", () => {
      expect(isValidTitle("a".repeat(MAX_TITLE_LENGTH))).toBe(true);
    });

    it("rejects a title shorter than the minimum", () => {
      expect(isValidTitle("a".repeat(MIN_TITLE_LENGTH - 1))).toBe(false);
    });

    it("rejects a title longer than the maximum", () => {
      expect(isValidTitle("a".repeat(MAX_TITLE_LENGTH + 1))).toBe(false);
    });

    it("evaluates length after trimming surrounding whitespace", () => {
      expect(isValidTitle(`  ${"a".repeat(MIN_TITLE_LENGTH)}  `)).toBe(true);
      expect(isValidTitle("  ab  ")).toBe(false);
    });

    it("exposes the bounds it enforces", () => {
      expect(MIN_TITLE_LENGTH).toBe(3);
      expect(MAX_TITLE_LENGTH).toBe(120);
    });
  });

  describe("isValidDescription", () => {
    it("accepts null (description is optional)", () => {
      expect(isValidDescription(null)).toBe(true);
    });

    it("accepts a description at the maximum length", () => {
      expect(isValidDescription("a".repeat(MAX_DESCRIPTION_LENGTH))).toBe(true);
    });

    it("rejects a description longer than the maximum", () => {
      expect(isValidDescription("a".repeat(MAX_DESCRIPTION_LENGTH + 1))).toBe(false);
    });
  });

  describe("normalizeOptionalText", () => {
    it("trims surrounding whitespace", () => {
      expect(normalizeOptionalText("  Full renovation.  ")).toBe("Full renovation.");
    });

    it("treats a whitespace-only value as null", () => {
      expect(normalizeOptionalText("   ")).toBeNull();
    });

    it("treats an empty string as null", () => {
      expect(normalizeOptionalText("")).toBeNull();
    });

    it("treats null/undefined as null", () => {
      expect(normalizeOptionalText(null)).toBeNull();
      expect(normalizeOptionalText(undefined)).toBeNull();
    });
  });

  describe("isValidMediaUrl", () => {
    it("accepts an https URL", () => {
      expect(isValidMediaUrl("https://res.cloudinary.com/demo/image/upload/v1/photo.jpg")).toBe(true);
    });

    it("accepts an http URL", () => {
      expect(isValidMediaUrl("http://example.com/photo.jpg")).toBe(true);
    });

    it("rejects a malformed string", () => {
      expect(isValidMediaUrl("not-a-url")).toBe(false);
    });

    it("rejects a javascript: URL", () => {
      expect(isValidMediaUrl("javascript:alert(1)")).toBe(false);
    });

    it("rejects a data: URL", () => {
      expect(isValidMediaUrl("data:text/html,<script>alert(1)</script>")).toBe(false);
    });

    it("rejects a relative path", () => {
      expect(isValidMediaUrl("/uploads/photo.jpg")).toBe(false);
    });
  });
});
