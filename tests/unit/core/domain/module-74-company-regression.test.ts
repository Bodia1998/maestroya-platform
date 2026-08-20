import { describe, expect, it } from "vitest";

import {
  BUSINESS_DOCUMENT_TYPES,
  COMPANY_VERIFICATION_DOCUMENT_TYPE_VALUES,
  canApprove as canApproveCompanyVerification,
  canSubmit as canSubmitCompanyVerification,
} from "@/domain/services/company-verification-rules";
import {
  BUSINESS_REGISTRATION_DOCUMENT_TYPES,
  VERIFICATION_DOCUMENT_TYPE_VALUES,
} from "@/domain/services/professional-verification-rules";

/**
 * Module 74 — Business Registration Enforcement, company regression suite.
 *
 * This module only ever touches the solo-professional side
 * (ProfessionalVerification / ProfessionalOnboarding — see
 * professional-verification-rules.ts / professional-onboarding-rules.ts).
 * `CompanyVerification` (Module 18) deliberately keeps its own, separate
 * `COMPANY_VERIFICATION_DOCUMENT_TYPE_VALUES` array and its own state
 * machine (company-verification-rules.ts) rather than sharing Module 17's —
 * so adding `BUSINESS_REGISTRATION` to the professional side's allowed
 * document types must have zero effect here. These tests pin that down
 * directly, rather than relying only on the pre-existing company test
 * suite staying green by omission.
 */
describe("Module 74 — company verification/activation regression", () => {
  it("does not add BUSINESS_REGISTRATION to the company's own allowed document types", () => {
    expect(COMPANY_VERIFICATION_DOCUMENT_TYPE_VALUES).not.toContain("BUSINESS_REGISTRATION");
  });

  it("leaves the company's own business-document requirement (BUSINESS_LICENSE/TAX_CERTIFICATE) unchanged", () => {
    expect(BUSINESS_DOCUMENT_TYPES).toEqual(["BUSINESS_LICENSE", "TAX_CERTIFICATE"]);
  });

  it("the professional-side business-registration config is a separate array from the company's document types", () => {
    // Confirms these are genuinely two independent constants, not the same
    // array reused across both modules (which would let a professional-side
    // config change silently alter company behavior).
    expect(BUSINESS_REGISTRATION_DOCUMENT_TYPES).not.toBe(COMPANY_VERIFICATION_DOCUMENT_TYPE_VALUES as unknown);
    expect(VERIFICATION_DOCUMENT_TYPE_VALUES).not.toBe(COMPANY_VERIFICATION_DOCUMENT_TYPE_VALUES as unknown);
  });

  it("company verification's state machine still behaves exactly as before (unaffected by Module 74)", () => {
    expect(canSubmitCompanyVerification("DRAFT")).toBe(true);
    expect(canSubmitCompanyVerification("PENDING")).toBe(false);
    expect(canApproveCompanyVerification("PENDING")).toBe(true);
    expect(canApproveCompanyVerification("UNDER_REVIEW")).toBe(true);
    expect(canApproveCompanyVerification("APPROVED")).toBe(false);
  });
});
