import { describe, expect, it } from "vitest";

import {
  buildRateLimitKey,
  contentFingerprint,
  hashIp,
  truncateUserAgent,
} from "@/domain/services/security-key";

describe("security-key: hashIp", () => {
  it("is deterministic for the same ip+pepper", () => {
    expect(hashIp("1.2.3.4", "pepper")).toBe(hashIp("1.2.3.4", "pepper"));
  });

  it("never contains the raw ip as a substring", () => {
    const hash = hashIp("1.2.3.4", "pepper");
    expect(hash).not.toContain("1.2.3.4");
  });

  it("produces different hashes for different ips", () => {
    expect(hashIp("1.2.3.4", "pepper")).not.toBe(hashIp("5.6.7.8", "pepper"));
  });

  it("produces different hashes for the same ip with a different pepper (keyed, not a bare hash)", () => {
    expect(hashIp("1.2.3.4", "pepper-a")).not.toBe(hashIp("1.2.3.4", "pepper-b"));
  });
});

describe("security-key: truncateUserAgent", () => {
  it("returns null for null/undefined/empty/whitespace-only input", () => {
    expect(truncateUserAgent(null)).toBeNull();
    expect(truncateUserAgent(undefined)).toBeNull();
    expect(truncateUserAgent("")).toBeNull();
    expect(truncateUserAgent("   ")).toBeNull();
  });

  it("passes short user agents through unchanged (trimmed)", () => {
    expect(truncateUserAgent("  Mozilla/5.0  ")).toBe("Mozilla/5.0");
  });

  it("truncates user agents longer than 200 characters", () => {
    const long = "a".repeat(500);
    const truncated = truncateUserAgent(long);
    expect(truncated).not.toBeNull();
    expect(truncated!.length).toBe(200);
  });
});

describe("security-key: buildRateLimitKey", () => {
  it("builds a key namespaced by policy name", () => {
    expect(buildRateLimitKey("LOGIN_BY_EMAIL", { resource: "a@example.com" })).toBe(
      "LOGIN_BY_EMAIL|resource:a@example.com",
    );
  });

  it("produces different keys for different policies with the same identity (no cross-policy collision)", () => {
    const a = buildRateLimitKey("POLICY_A", { userId: "user-1" });
    const b = buildRateLimitKey("POLICY_B", { userId: "user-1" });
    expect(a).not.toBe(b);
  });

  it("combines userId + ipHash + resource when all are present", () => {
    const key = buildRateLimitKey("QUOTE_CREATE_BY_USER", {
      userId: "user-1",
      ipHash: "hash-1",
      resource: "request-1",
    });
    expect(key).toBe("QUOTE_CREATE_BY_USER|user:user-1|ip:hash-1|resource:request-1");
  });

  it("throws if no identifying part is provided (would otherwise be a shared, unbounded key)", () => {
    expect(() => buildRateLimitKey("SOME_POLICY", {})).toThrow(RangeError);
  });
});

describe("security-key: contentFingerprint", () => {
  it("is stable for identical text", () => {
    expect(contentFingerprint("Hello world")).toBe(contentFingerprint("Hello world"));
  });

  it("normalizes case and whitespace so trivial variations collide", () => {
    expect(contentFingerprint("Hello   World")).toBe(contentFingerprint("hello world"));
    expect(contentFingerprint("  Hello World  ")).toBe(contentFingerprint("hello world"));
  });

  it("differs for genuinely different text", () => {
    expect(contentFingerprint("Hello world")).not.toBe(contentFingerprint("Goodbye world"));
  });
});
