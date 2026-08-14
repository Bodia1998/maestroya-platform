import { describe, expect, it } from "vitest";

import {
  detectAllFraudSignals,
  detectDuplicateAccounts,
  detectFakeRegistrationPattern,
  detectRepeatedDevice,
  detectRepeatedIp,
  detectSelfReferral,
  detectSuspiciousConversionVelocity,
  type PartnerActivitySignal,
} from "@/domain/services/affiliate-fraud-rules";

function signal(overrides: Partial<PartnerActivitySignal> = {}): PartnerActivitySignal {
  return {
    referredUserId: "user-1",
    visitorId: "visitor-1",
    ipHash: "iphash-1",
    userAgentTruncated: "ua-1",
    occurredAt: new Date("2026-01-01T00:00:00.000Z"),
    ...overrides,
  };
}

describe("Module 61 — affiliate-fraud-rules", () => {
  it("detects a partner referring themselves", () => {
    const findings = detectSelfReferral("partner-user", [signal({ referredUserId: "partner-user" })]);
    expect(findings).toHaveLength(1);
    expect(findings[0]!.type).toBe("SELF_REFERRAL");
  });

  it("does not flag a normal referral as self-referral", () => {
    const findings = detectSelfReferral("partner-user", [signal({ referredUserId: "someone-else" })]);
    expect(findings).toHaveLength(0);
  });

  it("flags a shared IP once it crosses the distinct-user threshold", () => {
    const signals = Array.from({ length: 4 }, (_, i) => signal({ referredUserId: `user-${i}`, ipHash: "shared-ip" }));
    const findings = detectRepeatedIp(signals, 4);
    expect(findings).toHaveLength(1);
    expect(findings[0]!.type).toBe("REPEATED_IP");
  });

  it("does not flag an IP shared by fewer users than the threshold", () => {
    const signals = Array.from({ length: 2 }, (_, i) => signal({ referredUserId: `user-${i}`, ipHash: "shared-ip" }));
    expect(detectRepeatedIp(signals, 4)).toHaveLength(0);
  });

  it("flags a shared device fingerprint once it crosses the threshold", () => {
    const signals = Array.from({ length: 4 }, (_, i) => signal({ referredUserId: `user-${i}`, userAgentTruncated: "shared-ua" }));
    const findings = detectRepeatedDevice(signals, 4);
    expect(findings).toHaveLength(1);
    expect(findings[0]!.type).toBe("REPEATED_DEVICE");
  });

  it("flags the same referred user attributed under multiple visitor identifiers", () => {
    const signals = [
      signal({ referredUserId: "user-1", visitorId: "visitor-a" }),
      signal({ referredUserId: "user-1", visitorId: "visitor-b" }),
    ];
    const findings = detectDuplicateAccounts(signals, 2);
    expect(findings).toHaveLength(1);
    expect(findings[0]!.type).toBe("DUPLICATE_ACCOUNT");
  });

  it("does not flag one referred user under a single visitor id", () => {
    const signals = [signal({ referredUserId: "user-1", visitorId: "visitor-a" })];
    expect(detectDuplicateAccounts(signals, 2)).toHaveLength(0);
  });

  it("flags an abnormal conversion burst within the time window", () => {
    const base = new Date("2026-01-01T00:00:00.000Z").getTime();
    const timestamps = Array.from({ length: 20 }, (_, i) => new Date(base + i * 1000));
    const findings = detectSuspiciousConversionVelocity(timestamps, 10 * 60 * 1000, 20);
    expect(findings).toHaveLength(1);
    expect(findings[0]!.type).toBe("SUSPICIOUS_CONVERSION");
  });

  it("does not flag conversions spread out well beyond the window", () => {
    const base = new Date("2026-01-01T00:00:00.000Z").getTime();
    const timestamps = Array.from({ length: 20 }, (_, i) => new Date(base + i * 60 * 60 * 1000));
    expect(detectSuspiciousConversionVelocity(timestamps, 10 * 60 * 1000, 20)).toHaveLength(0);
  });

  it("flags a high dead-registration ratio once the sample size is large enough", () => {
    const outcomes = Array.from({ length: 10 }, (_, i) => ({ referredUserId: `user-${i}`, becameActive: i === 0 }));
    const findings = detectFakeRegistrationPattern(outcomes, 5, 0.8);
    expect(findings).toHaveLength(1);
    expect(findings[0]!.type).toBe("FAKE_REGISTRATION");
  });

  it("never flags a fake-registration pattern below the minimum sample size", () => {
    const outcomes = Array.from({ length: 3 }, () => ({ referredUserId: "user-x", becameActive: false }));
    expect(detectFakeRegistrationPattern(outcomes, 5, 0.8)).toHaveLength(0);
  });

  it("never flags a healthy conversion ratio even with a large sample", () => {
    const outcomes = Array.from({ length: 20 }, (_, i) => ({ referredUserId: `user-${i}`, becameActive: true }));
    expect(detectFakeRegistrationPattern(outcomes, 5, 0.8)).toHaveLength(0);
  });

  it("detectAllFraudSignals combines every rule's findings", () => {
    const signals = [signal({ referredUserId: "partner-user" })];
    const findings = detectAllFraudSignals("partner-user", signals);
    expect(findings.some((f) => f.type === "SELF_REFERRAL")).toBe(true);
  });

  it("detectAllFraudSignals returns no findings for entirely clean activity", () => {
    const signals = [signal({ referredUserId: "user-1", ipHash: "ip-1", userAgentTruncated: "ua-1" })];
    expect(detectAllFraudSignals("partner-user", signals)).toHaveLength(0);
  });
});
