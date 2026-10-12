import { describe, expect, it } from "vitest";

import {
  LEAD_CONTACT_SHARING_BASES,
  UNCONFIGURED_LEAD_PRIVACY_POLICY,
  canWithdrawContactSharing,
  decideContactSharing,
  isRequestContentEligibleForMinimization,
  isValidNoticeVersion,
  isValidRetentionDays,
  parseLeadPrivacyConfig,
  requestContentRetentionCutoff,
  type LeadContactSharingEvidence,
} from "@/domain/services/lead-privacy";

const T0 = new Date("2026-10-01T10:00:00.000Z");
const evidence = (patch: Partial<LeadContactSharingEvidence> = {}): LeadContactSharingEvidence => ({
  basis: "CONSENT",
  noticeVersion: "v1",
  recordedAt: T0,
  withdrawnAt: null,
  ...patch,
});

describe("M158 — decideContactSharing (consent is one basis, not a universal one)", () => {
  it("policy undecided + no record: unchanged pre-M158 behaviour (no new gate) — NOT a consent", () => {
    expect(decideContactSharing(UNCONFIGURED_LEAD_PRIVACY_POLICY, null)).toEqual({ allowed: true });
  });

  it("policy CONSENT + no record: denied — an existing/legacy lead is never silently treated as consented", () => {
    expect(decideContactSharing({ contactSharingBasis: "CONSENT" }, null)).toEqual({ allowed: false, reason: "CONSENT_NOT_RECORDED" });
  });

  it("policy CONSENT + a notice-only record is denied: a notice is not a consent", () => {
    expect(decideContactSharing({ contactSharingBasis: "CONSENT" }, evidence({ basis: "OTHER_LAWFUL_BASIS" }))).toEqual({
      allowed: false,
      reason: "CONSENT_NOT_RECORDED",
    });
  });

  it("policy CONSENT + an active consent record: allowed", () => {
    expect(decideContactSharing({ contactSharingBasis: "CONSENT" }, evidence())).toEqual({ allowed: true });
  });

  it("a withdrawn consent denies under EVERY policy (withdrawal is effective for future processing)", () => {
    for (const contactSharingBasis of [null, "CONSENT", "OTHER_LAWFUL_BASIS"] as const) {
      expect(decideContactSharing({ contactSharingBasis }, evidence({ withdrawnAt: new Date(T0.getTime() + 1) }))).toEqual({
        allowed: false,
        reason: "CONSENT_WITHDRAWN",
      });
    }
  });

  it("another lawful basis needs no consent evidence at all", () => {
    expect(decideContactSharing({ contactSharingBasis: "OTHER_LAWFUL_BASIS" }, null)).toEqual({ allowed: true });
    expect(decideContactSharing({ contactSharingBasis: "OTHER_LAWFUL_BASIS" }, evidence({ basis: "OTHER_LAWFUL_BASIS" }))).toEqual({ allowed: true });
  });

  it("only a CONSENT record can be withdrawn", () => {
    expect(canWithdrawContactSharing({ basis: "CONSENT" })).toBe(true);
    expect(canWithdrawContactSharing({ basis: "OTHER_LAWFUL_BASIS" })).toBe(false);
    expect([...LEAD_CONTACT_SHARING_BASES]).toEqual(["CONSENT", "OTHER_LAWFUL_BASIS"]);
  });
});

describe("M158 — retention boundary dates (no invented period)", () => {
  const now = new Date("2026-10-12T00:00:00.000Z");

  it("no configured period => no cutoff => nothing is ever eligible", () => {
    const cutoff = requestContentRetentionCutoff(now, null);
    expect(cutoff).toBeNull();
    expect(isRequestContentEligibleForMinimization(new Date(0), cutoff)).toBe(false);
  });

  it("a corrupt period fails safe (no cutoff)", () => {
    for (const bad of [0, -1, 1.5, Number.NaN, 36_501]) expect(requestContentRetentionCutoff(now, bad)).toBeNull();
  });

  it("exactly `days` old IS eligible; one millisecond newer is NOT", () => {
    const cutoff = requestContentRetentionCutoff(now, 30)!;
    expect(cutoff.toISOString()).toBe("2026-09-12T00:00:00.000Z");
    expect(isRequestContentEligibleForMinimization(new Date(cutoff.getTime()), cutoff)).toBe(true);
    expect(isRequestContentEligibleForMinimization(new Date(cutoff.getTime() - 1), cutoff)).toBe(true);
    expect(isRequestContentEligibleForMinimization(new Date(cutoff.getTime() + 1), cutoff)).toBe(false);
  });

  it("validates the period range", () => {
    expect(isValidRetentionDays(1)).toBe(true);
    expect(isValidRetentionDays(36_500)).toBe(true);
    expect(isValidRetentionDays(0)).toBe(false);
    expect(isValidRetentionDays("30")).toBe(false);
  });
});

describe("M158 — notice version", () => {
  it("accepts opaque bounded identifiers only", () => {
    expect(isValidNoticeVersion("2026-10-01")).toBe(true);
    expect(isValidNoticeVersion("v1.2:es")).toBe(true);
    expect(isValidNoticeVersion("")).toBe(false);
    expect(isValidNoticeVersion("a".repeat(65))).toBe(false);
    expect(isValidNoticeVersion("has space")).toBe(false);
    expect(isValidNoticeVersion("<script>")).toBe(false);
    expect(isValidNoticeVersion(null)).toBe(false);
  });
});

describe("M158 — parseLeadPrivacyConfig", () => {
  it("empty environment: everything undecided, default batch, no warnings", () => {
    expect(parseLeadPrivacyConfig({})).toEqual({ policy: UNCONFIGURED_LEAD_PRIVACY_POLICY, batchSize: 100, warnings: [] });
  });

  it("reads valid values", () => {
    const parsed = parseLeadPrivacyConfig({
      LEAD_CONTACT_SHARING_BASIS: "OTHER_LAWFUL_BASIS",
      LEAD_CONTACT_SHARING_NOTICE_VERSION: "n-2026-10",
      LEAD_REQUEST_CONTENT_RETENTION_DAYS: "90",
      LEAD_PRIVACY_RETENTION_BATCH_SIZE: "25",
    });
    expect(parsed.policy).toEqual({ contactSharingBasis: "OTHER_LAWFUL_BASIS", noticeVersion: "n-2026-10", requestContentRetentionDays: 90 });
    expect(parsed.batchSize).toBe(25);
    expect(parsed.warnings).toEqual([]);
  });

  it("an unrecognised basis fails CLOSED to the stricter CONSENT gate, never to 'undecided'", () => {
    const parsed = parseLeadPrivacyConfig({ LEAD_CONTACT_SHARING_BASIS: "consent" });
    expect(parsed.policy.contactSharingBasis).toBe("CONSENT");
    expect(parsed.warnings).toHaveLength(1);
  });

  it("invalid retention / batch / version values are ignored (no period is applied) and warnings never echo the value", () => {
    const parsed = parseLeadPrivacyConfig({
      LEAD_REQUEST_CONTENT_RETENTION_DAYS: "-5 secret-value",
      LEAD_PRIVACY_RETENTION_BATCH_SIZE: "100000",
      LEAD_CONTACT_SHARING_NOTICE_VERSION: "bad value!",
    });
    expect(parsed.policy.requestContentRetentionDays).toBeNull();
    expect(parsed.policy.noticeVersion).toBeNull();
    expect(parsed.batchSize).toBe(100);
    expect(parsed.warnings).toHaveLength(3);
    expect(JSON.stringify(parsed.warnings)).not.toMatch(/secret-value|bad value|100000/);
  });
});
