import { describe, expect, it } from "vitest";

import {
  computeOnboardingProgress,
  isBusinessRegistrationVerified,
  isIdentityVerified,
  isPayoutAccountConnected,
  isProfileComplete,
  isValidIban,
  maskIban,
  normalizeIban,
  type ProfileCompletenessInput,
} from "@/domain/services/professional-onboarding-rules";

function completeProfile(overrides: Partial<ProfileCompletenessInput> = {}): ProfileCompletenessInput {
  return {
    businessName: "Acme Plumbing",
    bio: "We fix pipes.",
    contactPhone: "+34600000000",
    serviceRadiusKm: 20,
    yearsExperience: 5,
    categoryIds: ["cat-1"],
    hasPrimaryAddress: true,
    ...overrides,
  };
}

describe("professional-onboarding-rules (Module 62)", () => {
  describe("isProfileComplete", () => {
    it("is complete when every required field is present", () => {
      expect(isProfileComplete(completeProfile())).toBe(true);
    });

    it("is incomplete when businessName is missing", () => {
      expect(isProfileComplete(completeProfile({ businessName: null }))).toBe(false);
    });

    it("is incomplete when businessName is blank after trimming", () => {
      expect(isProfileComplete(completeProfile({ businessName: "   " }))).toBe(false);
    });

    it("is incomplete when there is no category selected", () => {
      expect(isProfileComplete(completeProfile({ categoryIds: [] }))).toBe(false);
    });

    it("is incomplete when there is no primary address", () => {
      expect(isProfileComplete(completeProfile({ hasPrimaryAddress: false }))).toBe(false);
    });

    it("is incomplete when serviceRadiusKm is null", () => {
      expect(isProfileComplete(completeProfile({ serviceRadiusKm: null }))).toBe(false);
    });

    it("treats serviceRadiusKm of 0 as present (not missing)", () => {
      expect(isProfileComplete(completeProfile({ serviceRadiusKm: 0 }))).toBe(true);
    });
  });

  describe("isIdentityVerified", () => {
    it("is true only for APPROVED", () => {
      expect(isIdentityVerified("APPROVED")).toBe(true);
      expect(isIdentityVerified("PENDING")).toBe(false);
      expect(isIdentityVerified("UNDER_REVIEW")).toBe(false);
      expect(isIdentityVerified(null)).toBe(false);
    });
  });

  describe("isBusinessRegistrationVerified (Module 74)", () => {
    it("is true only when the case is APPROVED and a business-registration document is present", () => {
      expect(isBusinessRegistrationVerified("APPROVED", ["BUSINESS_REGISTRATION"])).toBe(true);
    });

    it("is false when the case is APPROVED but no business-registration document is present", () => {
      expect(isBusinessRegistrationVerified("APPROVED", ["NATIONAL_ID"])).toBe(false);
      expect(isBusinessRegistrationVerified("APPROVED", [])).toBe(false);
    });

    it("is false when a business-registration document exists but the case is not APPROVED", () => {
      expect(isBusinessRegistrationVerified("PENDING", ["BUSINESS_REGISTRATION"])).toBe(false);
      expect(isBusinessRegistrationVerified("UNDER_REVIEW", ["BUSINESS_REGISTRATION"])).toBe(false);
      expect(isBusinessRegistrationVerified("REJECTED", ["BUSINESS_REGISTRATION"])).toBe(false);
      expect(isBusinessRegistrationVerified("RESUBMISSION_REQUIRED", ["BUSINESS_REGISTRATION"])).toBe(false);
      expect(isBusinessRegistrationVerified("EXPIRED", ["BUSINESS_REGISTRATION"])).toBe(false);
      expect(isBusinessRegistrationVerified(null, ["BUSINESS_REGISTRATION"])).toBe(false);
    });
  });

  describe("isPayoutAccountConnected", () => {
    it("treats PENDING and VERIFIED as connected, REJECTED and null as not", () => {
      expect(isPayoutAccountConnected("PENDING")).toBe(true);
      expect(isPayoutAccountConnected("VERIFIED")).toBe(true);
      expect(isPayoutAccountConnected("REJECTED")).toBe(false);
      expect(isPayoutAccountConnected(null)).toBe(false);
    });
  });

  describe("computeOnboardingProgress", () => {
    it("is eligible for activation only when all six steps are complete", () => {
      const progress = computeOnboardingProgress({
        termsAccepted: true,
        privacyPolicyAccepted: true,
        identityVerificationStatus: "APPROVED",
        verificationDocumentTypes: ["BUSINESS_REGISTRATION"],
        profile: completeProfile(),
        payoutAccountStatus: "PENDING",
      });

      expect(progress.isEligibleForActivation).toBe(true);
      expect(progress.completedStepCount).toBe(6);
      expect(progress.totalStepCount).toBe(6);
      expect(progress.steps.every((s) => s.complete)).toBe(true);
    });

    it("is not eligible when any single step is incomplete", () => {
      const progress = computeOnboardingProgress({
        termsAccepted: true,
        privacyPolicyAccepted: true,
        identityVerificationStatus: "PENDING",
        verificationDocumentTypes: [],
        profile: completeProfile(),
        payoutAccountStatus: "PENDING",
      });

      expect(progress.isEligibleForActivation).toBe(false);
      expect(progress.completedStepCount).toBe(4);
      const identityStep = progress.steps.find((s) => s.step === "IDENTITY_VERIFIED");
      expect(identityStep?.complete).toBe(false);
    });

    it("reports zero completed steps when nothing has been done", () => {
      const progress = computeOnboardingProgress({
        termsAccepted: false,
        privacyPolicyAccepted: false,
        identityVerificationStatus: null,
        verificationDocumentTypes: [],
        profile: completeProfile({ businessName: null, categoryIds: [], hasPrimaryAddress: false }),
        payoutAccountStatus: null,
      });

      expect(progress.completedStepCount).toBe(0);
      expect(progress.isEligibleForActivation).toBe(false);
    });

    it("is not eligible when identity is APPROVED but no business-registration document is present (Module 74)", () => {
      const progress = computeOnboardingProgress({
        termsAccepted: true,
        privacyPolicyAccepted: true,
        identityVerificationStatus: "APPROVED",
        verificationDocumentTypes: ["NATIONAL_ID"],
        profile: completeProfile(),
        payoutAccountStatus: "PENDING",
      });

      expect(progress.isEligibleForActivation).toBe(false);
      const businessRegStep = progress.steps.find((s) => s.step === "BUSINESS_REGISTRATION_VERIFIED");
      expect(businessRegStep?.complete).toBe(false);
    });
  });

  describe("IBAN validation (ISO 13616 / mod-97)", () => {
    it("accepts a structurally valid Spanish IBAN", () => {
      expect(isValidIban("ES9121000418450200051332")).toBe(true);
    });

    it("accepts the same IBAN with spaces", () => {
      expect(isValidIban("ES91 2100 0418 4502 0005 1332")).toBe(true);
    });

    it("rejects an IBAN with a bad checksum", () => {
      expect(isValidIban("ES0021000418450200051332")).toBe(false);
    });

    it("rejects a malformed IBAN (too short / wrong shape)", () => {
      expect(isValidIban("ES91")).toBe(false);
      expect(isValidIban("not-an-iban")).toBe(false);
      expect(isValidIban("")).toBe(false);
    });

    it("normalizeIban strips spaces/dashes and upper-cases", () => {
      expect(normalizeIban(" es91 2100-0418 4502 0005 1332 ")).toBe("ES9121000418450200051332");
    });

    it("maskIban never exposes more than the last 4 characters", () => {
      const masked = maskIban("ES9121000418450200051332");
      expect(masked).toBe("****1332");
      expect(masked).not.toContain("2100");
    });
  });
});
