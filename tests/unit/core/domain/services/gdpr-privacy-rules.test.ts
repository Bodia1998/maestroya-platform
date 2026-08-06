import { describe, expect, it } from "vitest";

import {
  GDPR_DATA_CATEGORIES,
  canHardDelete,
  classifyDataCategory,
  isAccountDeletionPreparable,
  isExportEligible,
  retentionReasonFor,
  shouldAnonymize,
  shouldRetain,
} from "@/domain/services/gdpr-privacy-rules";

describe("domain/services/gdpr-privacy-rules (Module 38 — GDPR Compliance)", () => {
  it("classifies every declared data category exactly once (no gaps)", () => {
    for (const category of GDPR_DATA_CATEGORIES) {
      const strategy = classifyDataCategory(category);
      expect(["HARD_DELETE", "ANONYMIZE", "RETAIN"]).toContain(strategy);
      expect(retentionReasonFor(category)).toBeTruthy();
    }
  });

  it("classifies auth credentials and notifications as hard-deletable", () => {
    expect(classifyDataCategory("AUTH_CREDENTIALS")).toBe("HARD_DELETE");
    expect(classifyDataCategory("NOTIFICATIONS")).toBe("HARD_DELETE");
    expect(canHardDelete("AUTH_CREDENTIALS")).toBe(true);
    expect(canHardDelete("NOTIFICATIONS")).toBe(true);
  });

  it("classifies verification documents as hard-deletable (sensitive, no retention need)", () => {
    expect(classifyDataCategory("VERIFICATION_DOCUMENTS")).toBe("HARD_DELETE");
  });

  it("classifies profile, marketplace-activity, messages, reviews, and company membership as anonymize", () => {
    for (const category of [
      "PROFILE_DATA",
      "MARKETPLACE_ACTIVITY",
      "MESSAGES",
      "REVIEWS",
      "COMPANY_MEMBERSHIP",
    ] as const) {
      expect(classifyDataCategory(category)).toBe("ANONYMIZE");
      expect(shouldAnonymize(category)).toBe(true);
    }
  });

  it("classifies financial, dispute/support, audit-log, and consent records as retain", () => {
    for (const category of [
      "MARKETPLACE_FINANCIAL",
      "DISPUTES_AND_SUPPORT",
      "AUDIT_LOG",
      "CONSENT_RECORDS",
    ] as const) {
      expect(classifyDataCategory(category)).toBe("RETAIN");
      expect(shouldRetain(category)).toBe(true);
    }
  });

  it("never classifies the same category under more than one predicate", () => {
    for (const category of GDPR_DATA_CATEGORIES) {
      const flags = [canHardDelete(category), shouldAnonymize(category), shouldRetain(category)];
      expect(flags.filter(Boolean)).toHaveLength(1);
    }
  });

  it("export eligibility does not depend on account status", () => {
    expect(isExportEligible({ status: "ACTIVE" })).toBe(true);
    expect(isExportEligible({ status: "SUSPENDED" })).toBe(true);
    expect(isExportEligible({ status: "PENDING_VERIFICATION" })).toBe(true);
  });

  it("account-deletion plans can always be prepared (this module never deletes)", () => {
    expect(isAccountDeletionPreparable({ status: "ACTIVE" })).toBe(true);
    expect(isAccountDeletionPreparable({ status: "SUSPENDED" })).toBe(true);
  });
});
