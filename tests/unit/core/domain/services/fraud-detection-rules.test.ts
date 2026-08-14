import { describe, expect, it } from "vitest";

import {
  detectSamePhoneClusters,
  detectSameIbanClusters,
  detectSuspiciousRegistrationPattern,
  detectRepeatedFailedVerification,
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
