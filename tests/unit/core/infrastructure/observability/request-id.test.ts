import { describe, expect, it } from "vitest";

import {
  generateRequestId,
  isValidRequestId,
  resolveRequestId,
  REQUEST_ID_HEADER,
} from "@/infrastructure/observability/request-id";

describe("infrastructure/observability/request-id", () => {
  it("uses a stable, conventional header name", () => {
    expect(REQUEST_ID_HEADER).toBe("x-request-id");
  });

  it("generates valid v4-shaped UUIDs", () => {
    const id = generateRequestId();
    expect(isValidRequestId(id)).toBe(true);
  });

  it("generates a fresh ID on every call", () => {
    expect(generateRequestId()).not.toBe(generateRequestId());
  });

  describe("isValidRequestId", () => {
    it.each([
      "550e8400-e29b-41d4-a716-446655440000",
      "550E8400-E29B-41D4-A716-446655440000",
    ])("accepts %s", (id) => {
      expect(isValidRequestId(id)).toBe(true);
    });

    it.each([
      null,
      undefined,
      "",
      "not-a-uuid",
      "'; DROP TABLE users; --",
      "550e8400e29b41d4a716446655440000",
      "550e8400-e29b-41d4-a716", // truncated
    ])("rejects %s", (id) => {
      expect(isValidRequestId(id)).toBe(false);
    });
  });

  describe("resolveRequestId", () => {
    it("reuses a valid incoming request ID", () => {
      const incoming = "550e8400-e29b-41d4-a716-446655440000";
      expect(resolveRequestId(incoming)).toBe(incoming);
    });

    it("generates a new ID when the incoming value is missing", () => {
      const resolved = resolveRequestId(null);
      expect(isValidRequestId(resolved)).toBe(true);
    });

    it("discards an untrusted/malformed incoming value rather than passing it through", () => {
      const attack = "<script>alert(1)</script>";
      const resolved = resolveRequestId(attack);
      expect(resolved).not.toBe(attack);
      expect(isValidRequestId(resolved)).toBe(true);
    });
  });
});
