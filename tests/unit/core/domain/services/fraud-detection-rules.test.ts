import { describe, expect, it } from "vitest";

import {
  detectSamePhoneClusters,
  detectSameIbanClusters,
  detectSuspiciousRegistrationPattern,
  detectRepeatedFailedVerification,
  detectHighRiskVpnProxyAccess,
  SUSPICIOUS_REGISTRATION_BURST_THRESHOLD,
  REPEATED_FAILED_VERIFICATION_THRESHOLD,
} from "@/domain/services/fraud-detection-rules";

describe("Module 65 — detectSamePhoneClusters", () => {
  it("flags a cluster shared by 2+ users", () => {
    const results = detectSamePhoneClusters([{ identifierHash: "h1", userIds: ["u1", "u2"] }]);
    expect(results).toHaveLength(1);
    expect(results[0]?.type).toBe("SAME_PHONE");
    expect(results[0]?.userIds).toEqual(["u1", "u2"]);
  });

  it("ignores a cluster with only one user", () => {
    expect(detectSamePhoneClusters([{ identifierHash: "h1", userIds: ["u1"] }])).toEqual([]);
  });

  it("dedupes duplicate userIds within a cluster", () => {
    const results = detectSameIbanClusters([{ identifierHash: "h1", userIds: ["u1", "u1", "u2"] }]);
    expect(results[0]?.userIds).toEqual(["u1", "u2"]);
  });
});

describe("Module 65 — detectSuspiciousRegistrationPattern", () => {
  it("flags a registration burst at the threshold", () => {
    const finding = detectSuspiciousRegistrationPattern({
      userId: "u1",
      accountsFromSameSourceInWindow: SUSPICIOUS_REGISTRATION_BURST_THRESHOLD,
      minutesToFirstAction: 10,
    });
    expect(finding).not.toBeNull();
    expect(finding?.type).toBe("SUSPICIOUS_REGISTRATION_PATTERN");
  });

  it("flags an implausibly fast first action", () => {
    const finding = detectSuspiciousRegistrationPattern({
      userId: "u1",
      accountsFromSameSourceInWindow: 1,
      minutesToFirstAction: 0,
    });
    expect(finding).not.toBeNull();
  });

  it("returns null when neither signal is present", () => {
    expect(
      detectSuspiciousRegistrationPattern({ userId: "u1", accountsFromSameSourceInWindow: 1, minutesToFirstAction: 30 }),
    ).toBeNull();
  });
});

describe("Module 65 — detectRepeatedFailedVerification", () => {
  it("returns null below the threshold", () => {
    expect(detectRepeatedFailedVerification("u1", REPEATED_FAILED_VERIFICATION_THRESHOLD - 1)).toBeNull();
  });

  it("flags at the threshold", () => {
    const finding = detectRepeatedFailedVerification("u1", REPEATED_FAILED_VERIFICATION_THRESHOLD);
    expect(finding?.type).toBe("REPEATED_FAILED_VERIFICATION");
  });
});

describe("Module 93 — detectHighRiskVpnProxyAccess", () => {
  it("flags a Tor connection regardless of riskLevel", () => {
    const finding = detectHighRiskVpnProxyAccess({ userId: "u1", riskLevel: "LOW", isTor: true, isHosting: false });
    expect(finding?.type).toBe("SUSPICIOUS_VPN_PROXY_ACCESS");
  });

  it("flags a datacenter/hosting connection regardless of riskLevel", () => {
    const finding = detectHighRiskVpnProxyAccess({ userId: "u1", riskLevel: "LOW", isTor: false, isHosting: true });
    expect(finding?.type).toBe("SUSPICIOUS_VPN_PROXY_ACCESS");
  });

  it("flags a HIGH/CRITICAL riskLevel even without Tor/hosting", () => {
    expect(detectHighRiskVpnProxyAccess({ userId: "u1", riskLevel: "HIGH", isTor: false, isHosting: false })).not.toBeNull();
    expect(detectHighRiskVpnProxyAccess({ userId: "u1", riskLevel: "CRITICAL", isTor: false, isHosting: false })).not.toBeNull();
  });

  it("does not flag a plain VPN at LOW/MEDIUM risk", () => {
    expect(detectHighRiskVpnProxyAccess({ userId: "u1", riskLevel: "LOW", isTor: false, isHosting: false })).toBeNull();
    expect(detectHighRiskVpnProxyAccess({ userId: "u1", riskLevel: "MEDIUM", isTor: false, isHosting: false })).toBeNull();
  });

  it("never flags an unavailable signal (UNKNOWN riskLevel) — provider failure must not mean fraud", () => {
    expect(detectHighRiskVpnProxyAccess({ userId: "u1", riskLevel: "UNKNOWN", isTor: null, isHosting: null })).toBeNull();
  });
});
