import { describe, expect, it } from "vitest";

import { Consent } from "@/domain/entities/consent";
import { ValidationError } from "@/domain/errors/domain-error";

function grantConsent(overrides: Partial<Parameters<typeof Consent.grant>[0]> = {}) {
  return Consent.grant({
    userId: "user_1",
    type: "TERMS_OF_SERVICE",
    version: "2026-01-01",
    ...overrides,
  });
}

describe("domain/entities/consent (Module 38 — GDPR Compliance)", () => {
  describe("grant", () => {
    it("creates an active consent with sensible defaults", () => {
      const consent = grantConsent();

      expect(consent.userId).toBe("user_1");
      expect(consent.type).toBe("TERMS_OF_SERVICE");
      expect(consent.version).toBe("2026-01-01");
      expect(consent.withdrawnAt).toBeNull();
      expect(consent.isActive).toBe(true);
      expect(consent.id).toBeTruthy();
    });

    it("accepts an explicit id and grantedAt", () => {
      const grantedAt = new Date("2026-02-01T00:00:00Z");
      const consent = grantConsent({ id: "consent_123", grantedAt });

      expect(consent.id).toBe("consent_123");
      expect(consent.grantedAt).toBe(grantedAt);
    });

    it("rejects a missing userId", () => {
      expect(() => grantConsent({ userId: "" })).toThrow(ValidationError);
    });

    it("rejects a missing version", () => {
      expect(() => grantConsent({ version: "  " })).toThrow(ValidationError);
    });
  });

  describe("withdraw", () => {
    it("returns a new, withdrawn Consent without mutating the original (immutability)", () => {
      const granted = grantConsent({ grantedAt: new Date("2026-01-01T00:00:00Z") });
      const withdrawn = granted.withdraw(new Date("2026-03-01T00:00:00Z"));

      // The original instance is untouched.
      expect(granted.isActive).toBe(true);
      expect(granted.withdrawnAt).toBeNull();

      // The returned instance carries the same identity and data, now withdrawn.
      expect(withdrawn.id).toBe(granted.id);
      expect(withdrawn.userId).toBe(granted.userId);
      expect(withdrawn.type).toBe(granted.type);
      expect(withdrawn.isActive).toBe(false);
      expect(withdrawn.withdrawnAt).toEqual(new Date("2026-03-01T00:00:00Z"));
    });

    it("defaults withdrawnAt to now when not supplied", () => {
      const withdrawn = grantConsent().withdraw();
      expect(withdrawn.withdrawnAt).toBeInstanceOf(Date);
    });

    it("rejects withdrawing an already-withdrawn consent", () => {
      const withdrawn = grantConsent().withdraw();
      expect(() => withdrawn.withdraw()).toThrow(ValidationError);
    });

    it("rejects a withdrawnAt earlier than grantedAt", () => {
      const consent = grantConsent({ grantedAt: new Date("2026-02-01T00:00:00Z") });
      expect(() => consent.withdraw(new Date("2026-01-01T00:00:00Z"))).toThrow(ValidationError);
    });
  });

  describe("reconstitute", () => {
    it("rehydrates already-persisted state without re-running grant()'s validation", () => {
      const consent = Consent.reconstitute(
        {
          userId: "user_1",
          type: "MARKETING",
          version: "v1",
          grantedAt: new Date("2026-01-01T00:00:00Z"),
          withdrawnAt: new Date("2026-02-01T00:00:00Z"),
        },
        "consent_1",
      );

      expect(consent.id).toBe("consent_1");
      expect(consent.isActive).toBe(false);
    });
  });
});
