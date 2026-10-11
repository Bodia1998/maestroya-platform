import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

import { LEAD_FEE_REFUND_REASON_CODES } from "@/domain/services/lead-fee-refund";
import {
  LEAD_QUALITY_CLAIM_ALLOWED_ACTOR_ROLES,
  LEAD_QUALITY_CLAIM_OPEN_STATUSES,
  LEAD_QUALITY_CLAIM_REASON_CODES,
  LEAD_QUALITY_CLAIM_STATUSES,
  LEAD_QUALITY_CLAIM_TRANSITIONS,
  LeadQualityClaimRejectedError,
  canTransitionLeadQualityClaim,
  isLeadQualityClaimReasonCode,
  isOpenLeadQualityClaimStatus,
  isWithinLeadQualityClaimWindow,
  leadQualityClaimPeriodStart,
  leadQualityClaimRespondBy,
  leadQualityClaimWindowEnd,
  normalizeLeadQualityClaimDecisionExplanation,
  normalizeLeadQualityClaimDescription,
  normalizeLeadQualityClaimEvidenceReference,
} from "@/domain/services/lead-quality-claim";

const reason = (fn: () => unknown) => {
  try {
    fn();
  } catch (e) {
    return e instanceof LeadQualityClaimRejectedError ? e.reason : "OTHER";
  }
  return null;
};

describe("Module 154 — lead quality claim domain rules", () => {
  it("allows exactly the three approved reasons — no workmanship / service-quality / price reason exists", () => {
    expect([...LEAD_QUALITY_CLAIM_REASON_CODES]).toEqual(["CONTACT_UNREACHABLE", "CONTACT_INVALID", "DUPLICATE_LEAD"]);
    for (const bad of ["WORKMANSHIP", "SERVICE_QUALITY", "PRICE_DISPUTE", "NO_AGREEMENT", "CUSTOMER_NO_RESPONSE", "PLATFORM_ERROR", "DUPLICATE_CHARGE", "CLAIM_APPROVED", "", null, 1]) {
      expect(isLeadQualityClaimReasonCode(bad)).toBe(false);
    }
  });

  it("claim reasons and M153 refund reasons are disjoint vocabularies (a claim reason is never a refund reason)", () => {
    const claim = LEAD_QUALITY_CLAIM_REASON_CODES as readonly string[];
    for (const refundReason of LEAD_FEE_REFUND_REASON_CODES) expect(claim).not.toContain(refundReason);
    expect(LEAD_FEE_REFUND_REASON_CODES as readonly string[]).not.toContain("CLAIM_APPROVED");
  });

  it("pins the local actor-role constant to the real RBAC role values (drift fails the build)", () => {
    const rbac = readFileSync(path.resolve(__dirname, "../../../../../src/core/infrastructure/auth/rbac.ts"), "utf8");
    const roles = Object.fromEntries([...rbac.matchAll(/^\s+([A-Z_]+):\s*"([A-Z_]+)",?\s*$/gm)].map((m) => [m[1], m[2]]));
    expect([...LEAD_QUALITY_CLAIM_ALLOWED_ACTOR_ROLES]).toEqual([roles.ADMIN, roles.SUPER_ADMIN]);
  });

  describe("state machine", () => {
    it("allows exactly SUBMITTED -> UNDER_REVIEW | APPROVED | REJECTED and UNDER_REVIEW -> APPROVED | REJECTED", () => {
      expect(LEAD_QUALITY_CLAIM_TRANSITIONS).toEqual({
        SUBMITTED: ["UNDER_REVIEW", "APPROVED", "REJECTED"],
        UNDER_REVIEW: ["APPROVED", "REJECTED"],
        APPROVED: [],
        REJECTED: [],
      });
    });

    it("rejects every other move: terminal states are final, nothing goes back, approve and reject are mutually exclusive", () => {
      const allowed = new Set(["SUBMITTED>UNDER_REVIEW", "SUBMITTED>APPROVED", "SUBMITTED>REJECTED", "UNDER_REVIEW>APPROVED", "UNDER_REVIEW>REJECTED"]);
      for (const from of LEAD_QUALITY_CLAIM_STATUSES) {
        for (const to of LEAD_QUALITY_CLAIM_STATUSES) {
          expect(canTransitionLeadQualityClaim(from, to), `${from}>${to}`).toBe(allowed.has(`${from}>${to}`));
        }
      }
      expect(canTransitionLeadQualityClaim("APPROVED", "REJECTED")).toBe(false);
      expect(canTransitionLeadQualityClaim("REJECTED", "APPROVED")).toBe(false);
    });

    it("defines open statuses consistently: SUBMITTED and UNDER_REVIEW only", () => {
      expect([...LEAD_QUALITY_CLAIM_OPEN_STATUSES]).toEqual(["SUBMITTED", "UNDER_REVIEW"]);
      expect(LEAD_QUALITY_CLAIM_STATUSES.filter(isOpenLeadQualityClaimStatus)).toEqual(["SUBMITTED", "UNDER_REVIEW"]);
    });
  });

  describe("time rules", () => {
    const confirmed = new Date("2026-10-10T10:00:00.000Z");
    it("the claim window is 72 hours after confirmedAt, inclusive, never before confirmation", () => {
      expect(leadQualityClaimWindowEnd(confirmed).toISOString()).toBe("2026-10-13T10:00:00.000Z");
      expect(isWithinLeadQualityClaimWindow(confirmed, new Date("2026-10-13T10:00:00.000Z"))).toBe(true);
      expect(isWithinLeadQualityClaimWindow(confirmed, new Date("2026-10-13T10:00:00.001Z"))).toBe(false);
      expect(isWithinLeadQualityClaimWindow(confirmed, confirmed)).toBe(true);
      expect(isWithinLeadQualityClaimWindow(confirmed, new Date("2026-10-10T09:59:59.999Z"))).toBe(false);
    });

    it("respondBy is submittedAt + 72 hours and the period is a rolling 30 days", () => {
      const at = new Date("2026-10-11T12:00:00.000Z");
      expect(leadQualityClaimRespondBy(at).toISOString()).toBe("2026-10-14T12:00:00.000Z");
      expect(leadQualityClaimPeriodStart(at).toISOString()).toBe("2026-09-11T12:00:00.000Z");
    });
  });

  describe("free text (conservative, heuristic — not a guarantee)", () => {
    it("accepts a plain description and stores it verbatim (trimmed, never truncated)", () => {
      expect(normalizeLeadQualityClaimDescription("  The phone number rings out every time.  ")).toBe("The phone number rings out every time.");
      expect(normalizeLeadQualityClaimDescription("x".repeat(1000))).toHaveLength(1000);
    });

    it("rejects too short / too long / non-string descriptions", () => {
      for (const bad of ["", "   ", "too short", "x".repeat(1001), 5, null, undefined]) expect(reason(() => normalizeLeadQualityClaimDescription(bad)), String(bad)).toBe("INVALID_INPUT");
    });

    it("rejects obvious e-mail, phone-like numbers and URLs in descriptions and decision explanations", () => {
      for (const bad of ["Call me at ana@example.com please", "The number +34 612 345 678 is wrong", "Number 612345678 never answers", "See https://example.com/x", "see www.example.com now"]) {
        expect(reason(() => normalizeLeadQualityClaimDescription(bad)), bad).toBe("INVALID_INPUT");
        expect(reason(() => normalizeLeadQualityClaimDecisionExplanation(bad)), bad).toBe("INVALID_INPUT");
      }
    });

    it("requires a non-empty decision explanation (1..1000 characters after trim)", () => {
      expect(normalizeLeadQualityClaimDecisionExplanation(" Confirmed unreachable. ")).toBe("Confirmed unreachable.");
      for (const bad of ["", "   ", "x".repeat(1001), undefined, null, 3]) expect(reason(() => normalizeLeadQualityClaimDecisionExplanation(bad))).toBe("INVALID_INPUT");
    });

    it("evidence is an OPTIONAL opaque id, never free text", () => {
      expect(normalizeLeadQualityClaimEvidenceReference(undefined)).toBeNull();
      expect(normalizeLeadQualityClaimEvidenceReference(null)).toBeNull();
      expect(normalizeLeadQualityClaimEvidenceReference(" SHOT-123/a.png ")).toBe("SHOT-123/a.png");
      for (const bad of ["", "   ", "has spaces", "x".repeat(201), "-leading", "a@b.co", 7]) expect(reason(() => normalizeLeadQualityClaimEvidenceReference(bad)), String(bad)).toBe("INVALID_INPUT");
    });
  });

  it("the rejection error carries a closed code and a message free of claim content", () => {
    const error = new LeadQualityClaimRejectedError("PURCHASE_NOT_CLAIMABLE");
    expect(error.reason).toBe("PURCHASE_NOT_CLAIMABLE");
    expect(error.message).toBe("Lead quality claim rejected: PURCHASE_NOT_CLAIMABLE.");
  });
});
