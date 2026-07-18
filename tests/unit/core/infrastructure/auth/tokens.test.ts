import { describe, expect, it } from "vitest";

import { generateRawToken, hashToken } from "@/core/infrastructure/auth/tokens";

describe("auth tokens", () => {
  it("generates a high-entropy, URL-safe token", () => {
    const token = generateRawToken();
    expect(token.length).toBeGreaterThan(32);
    expect(token).toMatch(/^[A-Za-z0-9_-]+$/);
  });

  it("generates a different token on every call", () => {
    expect(generateRawToken()).not.toBe(generateRawToken());
  });

  it("hashes deterministically (same input -> same hash)", () => {
    const token = generateRawToken();
    expect(hashToken(token)).toBe(hashToken(token));
  });

  it("produces different hashes for different tokens", () => {
    expect(hashToken(generateRawToken())).not.toBe(hashToken(generateRawToken()));
  });

  it("hash never contains the raw token", () => {
    const token = generateRawToken();
    expect(hashToken(token)).not.toContain(token);
  });
});
