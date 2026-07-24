import { describe, expect, it } from "vitest";

import {
  APPROVAL_VALIDITY_DAYS,
  MAX_REVIEW_REASON_LENGTH,
  MIN_REVIEW_REASON_LENGTH,
  canApprove,
  canModifyDocuments,
  canReject,
  canRequestResubmission,
  canResubmit,
  canStartReview,
  canSubmit,
  canTransition,
  computeExpiresAt,
  hasRequiredDocuments,
  isActiveStatus,
  isValidReviewReason,
  normalizeOptionalText,
} from "@/domain/services/professional-verification-rules";

describe("professional-verification-rules (Module 17)", () => {
  describe("canTransition", () => {
    it("allows the documented transitions", () => {
      expect(canTransition("DRAFT", "PENDING")).toBe(true);
      expect(canTransition("PENDING", "UNDER_REVIEW")).toBe(true);
      expect(canTransition("PENDING", "APPROVED")).toBe(true);
      expect(canTransition("PENDING", "REJECTED")).toBe(true);
      expect(canTransition("PENDING", "RESUBMISSION_REQUIRED")).toBe(true);
      expect(canTransition("UNDER_REVIEW", "APPROVED")).toBe(true);
      expect(canTransition("RESUBMISSION_REQUIRED", "PENDING")).toBe(true);
      expect(canTransition("REJECTED", "PENDING")).toBe(true);
      expect(canTransition("APPROVED", "EXPIRED")).toBe(true);
    });

    it("rejects illegal transitions", () => {
      expect(canTransition("DRAFT", "APPROVED")).toBe(false);
      expect(canTransition("APPROVED", "REJECTED")).toBe(false);
      expect(canTransition("EXPIRED", "PENDING")).toBe(false);
      expect(canTransition("REJECTED", "APPROVED")).toBe(false);
      expect(canTransition("UNDER_REVIEW", "DRAFT")).toBe(false);
    });
  });

  describe("state predicates", () => {
    it("treats every status except EXPIRED as active", () => {
      expect(isActiveStatus("DRAFT")).toBe(true);
      expect(isActiveStatus("APPROVED")).toBe(true);
      expect(isActiveStatus("REJECTED")).toBe(true);
      expect(isActiveStatus("EXPIRED")).toBe(false);
    });

    it("gates who/what for each action", () => {
      expect(canStartReview("PENDING")).toBe(true);
      expect(canStartReview("UNDER_REVIEW")).toBe(false);
      expect(canApprove("PENDING")).toBe(true);
      expect(canApprove("UNDER_REVIEW")).toBe(true);
      expect(canApprove("DRAFT")).toBe(false);
      expect(canReject("UNDER_REVIEW")).toBe(true);
      expect(canRequestResubmission("PENDING")).toBe(true);
      expect(canSubmit("DRAFT")).toBe(true);
      expect(canSubmit("PENDING")).toBe(false);
      expect(canResubmit("RESUBMISSION_REQUIRED")).toBe(true);
      expect(canResubmit("REJECTED")).toBe(true);
      expect(canResubmit("DRAFT")).toBe(false);
    });

    it("only allows document edits before submission or on resubmission-required", () => {
      expect(canModifyDocuments("DRAFT")).toBe(true);
      expect(canModifyDocuments("RESUBMISSION_REQUIRED")).toBe(true);
      expect(canModifyDocuments("PENDING")).toBe(false);
      expect(canModifyDocuments("UNDER_REVIEW")).toBe(false);
      expect(canModifyDocuments("APPROVED")).toBe(false);
    });
  });

  describe("hasRequiredDocuments", () => {
    it("requires at least one identity document", () => {
      expect(hasRequiredDocuments(["NATIONAL_ID"])).toBe(true);
      expect(hasRequiredDocuments(["PASSPORT", "INSURANCE_CERTIFICATE"])).toBe(true);
      expect(hasRequiredDocuments(["DRIVER_LICENSE"])).toBe(true);
    });

    it("rejects a set with no identity document", () => {
      expect(hasRequiredDocuments([])).toBe(false);
      expect(hasRequiredDocuments(["INSURANCE_CERTIFICATE", "TAX_CERTIFICATE"])).toBe(false);
    });
  });

  describe("isValidReviewReason", () => {
    it("requires a non-empty, bounded reason", () => {
      expect(isValidReviewReason("a".repeat(MIN_REVIEW_REASON_LENGTH))).toBe(true);
      expect(isValidReviewReason("a".repeat(MAX_REVIEW_REASON_LENGTH))).toBe(true);
      expect(isValidReviewReason("short")).toBe(false);
      expect(isValidReviewReason("   ")).toBe(false);
      expect(isValidReviewReason("a".repeat(MAX_REVIEW_REASON_LENGTH + 1))).toBe(false);
    });
  });

  describe("computeExpiresAt", () => {
    it("adds the validity window", () => {
      const from = new Date("2026-01-01T00:00:00.000Z");
      const expires = computeExpiresAt(from);
      const days = Math.round((expires.getTime() - from.getTime()) / (24 * 60 * 60 * 1000));
      expect(days).toBe(APPROVAL_VALIDITY_DAYS);
    });
  });

  describe("normalizeOptionalText", () => {
    it("collapses empty/whitespace to null and trims otherwise", () => {
      expect(normalizeOptionalText(null)).toBeNull();
      expect(normalizeOptionalText("   ")).toBeNull();
      expect(normalizeOptionalText("  hi  ")).toBe("hi");
    });
  });
});
