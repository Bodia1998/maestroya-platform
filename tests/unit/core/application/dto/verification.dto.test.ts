import { describe, expect, it } from "vitest";

import {
  listAdminVerificationsSchema,
  rejectVerificationSchema,
  requestVerificationResubmissionSchema,
  uploadVerificationDocumentSchema,
  verificationDocumentIdSchema,
} from "@/application/dto/verification.dto";

const UUID = "11111111-1111-1111-1111-111111111111";

describe("verification.dto (Module 17)", () => {
  describe("uploadVerificationDocumentSchema", () => {
    it("accepts a known document type", () => {
      expect(uploadVerificationDocumentSchema.safeParse({ type: "NATIONAL_ID" }).success).toBe(true);
    });
    it("rejects an unknown document type", () => {
      expect(uploadVerificationDocumentSchema.safeParse({ type: "SELFIE" }).success).toBe(false);
    });
  });

  describe("verificationDocumentIdSchema", () => {
    it("requires a uuid", () => {
      expect(verificationDocumentIdSchema.safeParse({ documentId: UUID }).success).toBe(true);
      expect(verificationDocumentIdSchema.safeParse({ documentId: "nope" }).success).toBe(false);
    });
  });

  describe("listAdminVerificationsSchema", () => {
    it("defaults pagination and accepts an optional status", () => {
      const parsed = listAdminVerificationsSchema.parse({});
      expect(parsed.limit).toBe(20);
      expect(parsed.offset).toBe(0);
      expect(listAdminVerificationsSchema.safeParse({ status: "PENDING" }).success).toBe(true);
    });
    it("rejects an invalid status", () => {
      expect(listAdminVerificationsSchema.safeParse({ status: "NONSENSE" }).success).toBe(false);
    });
  });

  describe("reason-bearing admin schemas", () => {
    it("requires a reason of at least the minimum length", () => {
      expect(rejectVerificationSchema.safeParse({ verificationId: UUID, reason: "too short" }).success).toBe(false);
      expect(
        rejectVerificationSchema.safeParse({ verificationId: UUID, reason: "This is a valid, detailed reason." })
          .success,
      ).toBe(true);
    });
    it("requires a reason for resubmission too", () => {
      expect(requestVerificationResubmissionSchema.safeParse({ verificationId: UUID, reason: "" }).success).toBe(false);
      expect(
        requestVerificationResubmissionSchema.safeParse({
          verificationId: UUID,
          reason: "Please re-upload a clearer photo of your ID.",
        }).success,
      ).toBe(true);
    });
    it("rejects a missing/invalid verification id", () => {
      expect(rejectVerificationSchema.safeParse({ verificationId: "x", reason: "a".repeat(20) }).success).toBe(false);
    });
  });
});
