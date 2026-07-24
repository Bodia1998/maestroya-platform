import { describe, expect, it } from "vitest";

import {
  canTransitionInvitation,
  computeInvitationExpiresAt,
  generateInvitationToken,
  hashInvitationToken,
  isInvitableRole,
  isInvitationActionable,
} from "@/domain/services/company-invitation-rules";

describe("company-invitation-rules (Module 18)", () => {
  describe("canTransitionInvitation", () => {
    it("allows PENDING to move to any terminal state", () => {
      expect(canTransitionInvitation("PENDING", "ACCEPTED")).toBe(true);
      expect(canTransitionInvitation("PENDING", "DECLINED")).toBe(true);
      expect(canTransitionInvitation("PENDING", "EXPIRED")).toBe(true);
      expect(canTransitionInvitation("PENDING", "CANCELLED")).toBe(true);
    });

    it("rejects any transition out of a terminal state (invalid transitions rejected)", () => {
      expect(canTransitionInvitation("ACCEPTED", "PENDING")).toBe(false);
      expect(canTransitionInvitation("CANCELLED", "ACCEPTED")).toBe(false);
      expect(canTransitionInvitation("DECLINED", "ACCEPTED")).toBe(false);
      expect(canTransitionInvitation("EXPIRED", "ACCEPTED")).toBe(false);
    });
  });

  describe("isInvitationActionable", () => {
    const now = new Date("2026-01-01T00:00:00Z");

    it("a PENDING, unexpired invitation is actionable", () => {
      const future = new Date("2026-01-15T00:00:00Z");
      expect(isInvitationActionable("PENDING", future, now)).toBe(true);
    });

    it("expired invitations are rejected even if still marked PENDING", () => {
      const past = new Date("2025-12-01T00:00:00Z");
      expect(isInvitationActionable("PENDING", past, now)).toBe(false);
    });

    it("cancelled invitations cannot be accepted", () => {
      const future = new Date("2026-01-15T00:00:00Z");
      expect(isInvitationActionable("CANCELLED", future, now)).toBe(false);
    });

    it("declined/accepted invitations are not actionable again", () => {
      const future = new Date("2026-01-15T00:00:00Z");
      expect(isInvitationActionable("DECLINED", future, now)).toBe(false);
      expect(isInvitationActionable("ACCEPTED", future, now)).toBe(false);
    });
  });

  describe("isInvitableRole", () => {
    it("never allows inviting someone directly as OWNER", () => {
      expect(isInvitableRole("OWNER")).toBe(false);
      expect(isInvitableRole("ADMIN")).toBe(true);
      expect(isInvitableRole("MANAGER")).toBe(true);
      expect(isInvitableRole("MEMBER")).toBe(true);
    });
  });

  describe("computeInvitationExpiresAt", () => {
    it("expires 14 days after issuance", () => {
      const from = new Date("2026-01-01T00:00:00Z");
      const expires = computeInvitationExpiresAt(from);
      expect(expires.getUTCDate()).toBe(15);
    });
  });

  describe("token generation/hashing", () => {
    it("generates a token whose hash is deterministic and never equal to the raw token", () => {
      const { token, tokenHash } = generateInvitationToken();
      expect(token).not.toBe(tokenHash);
      expect(hashInvitationToken(token)).toBe(tokenHash);
    });

    it("generates a fresh, unique token each call", () => {
      const a = generateInvitationToken();
      const b = generateInvitationToken();
      expect(a.token).not.toBe(b.token);
    });
  });
});
