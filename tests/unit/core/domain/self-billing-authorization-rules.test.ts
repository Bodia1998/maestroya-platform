import { describe, expect, it } from "vitest";
import { canRevokeSelfBillingAuthorization, isSelfBillingAuthorized } from "@/domain/services/self-billing-authorization-rules";
import type { SelfBillingAuthorizationRecord } from "@/domain/repositories/self-billing-authorization-repository";

function makeAuthorization(overrides: Partial<SelfBillingAuthorizationRecord> = {}): SelfBillingAuthorizationRecord {
  return {
    id: "auth-1",
    professionalProfileId: "professional-1",
    companyProfileId: null,
    status: "ACTIVE",
    agreementVersion: "self-billing-agreement-es-v1",
    acceptedByUserId: "user-1",
    acceptedAt: new Date("2026-01-01T00:00:00Z"),
    acceptanceIpAddress: null,
    acceptanceUserAgent: null,
    revokedAt: null,
    revokedByUserId: null,
    createdAt: new Date("2026-01-01T00:00:00Z"),
    updatedAt: new Date("2026-01-01T00:00:00Z"),
    ...overrides,
  };
}

describe("self-billing-authorization-rules", () => {
  it("is not authorized when no authorization record exists at all", () => {
    expect(isSelfBillingAuthorized(null)).toBe(false);
  });

  it("is authorized only when the record's status is ACTIVE", () => {
    expect(isSelfBillingAuthorized(makeAuthorization({ status: "ACTIVE" }))).toBe(true);
    expect(isSelfBillingAuthorized(makeAuthorization({ status: "REVOKED" }))).toBe(false);
  });

  it("never assumes authorization by default — a professional with no record is never authorized", () => {
    // Regression guard for the module brief's explicit "do not assume
    // every professional automatically has self-billing authorization."
    expect(isSelfBillingAuthorized(null)).toBe(false);
  });

  it("can only revoke an ACTIVE authorization", () => {
    expect(canRevokeSelfBillingAuthorization(makeAuthorization({ status: "ACTIVE" }))).toBe(true);
    expect(canRevokeSelfBillingAuthorization(makeAuthorization({ status: "REVOKED" }))).toBe(false);
    expect(canRevokeSelfBillingAuthorization(null)).toBe(false);
  });
});
