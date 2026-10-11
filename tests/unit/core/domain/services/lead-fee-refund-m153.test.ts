import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

import { PaymentGatewayError, type PaymentGatewayErrorCategory } from "@/domain/errors/domain-error";
import {
  LEAD_FEE_REFUND_ACTIVE_STATUSES,
  LEAD_FEE_REFUND_ALLOWED_ACTOR_ROLES,
  LEAD_FEE_REFUND_REASON_CODES,
  LEAD_FEE_REFUND_STATUSES,
  LEAD_FEE_REFUND_TRANSITIONS,
  LeadFeeRefundRejectedError,
  assertLeadFeeRefundablePayment,
  canTransitionLeadFeeRefund,
  isAutomaticTechnicalRefundAllowed,
  isDefinitiveLeadFeeRefundRejection,
  leadFeeRefundIdempotencyKey,
  normalizeLeadFeeRefundEvidenceReference,
  normalizeLeadFeeRefundExplanation,
  normalizeLeadFeeRefundProviderReference,
  resolveLeadFeeRefundConfig,
  type LeadFeeRefundablePaymentFacts,
} from "@/domain/services/lead-fee-refund";

const reason = (fn: () => unknown) => {
  try {
    fn();
  } catch (e) {
    return e instanceof LeadFeeRefundRejectedError ? e.reason : "OTHER";
  }
  return null;
};

describe("Module 153 — lead-fee refund domain rules", () => {
  it("allows exactly PLATFORM_ERROR and DUPLICATE_CHARGE (CLAIM_APPROVED / UNFULFILLABLE_PAYMENT are not representable)", () => {
    expect([...LEAD_FEE_REFUND_REASON_CODES]).toEqual(["PLATFORM_ERROR", "DUPLICATE_CHARGE"]);
  });

  it("pins the local actor-role constant to the real RBAC role values (drift fails the build)", () => {
    // Read as text (importing the RBAC module would pull in the whole auth/Prisma chain).
    const rbac = readFileSync(path.resolve(__dirname, "../../../../../src/core/infrastructure/auth/rbac.ts"), "utf8");
    const roles = Object.fromEntries([...rbac.matchAll(/^\s+([A-Z_]+):\s*"([A-Z_]+)",?\s*$/gm)].map((m) => [m[1], m[2]]));
    expect(roles.ADMIN).toBe("ADMIN");
    expect(roles.SUPER_ADMIN).toBe("SUPER_ADMIN");
    expect([...LEAD_FEE_REFUND_ALLOWED_ACTOR_ROLES]).toEqual([roles.ADMIN, roles.SUPER_ADMIN]);
  });

  describe("switches (config only, fail closed)", () => {
    it("is OFF by default and when empty/false", () => {
      for (const env of [{}, { LEAD_FEE_REFUND_REAL_REFUNDS_ENABLED: "" }, { LEAD_FEE_REFUND_REAL_REFUNDS_ENABLED: "false" }]) {
        expect(resolveLeadFeeRefundConfig(env)).toEqual({ status: "VALID", realRefundsEnabled: false, automaticTechnicalRefundsEnabled: false });
      }
    });
    it("is ON only for the exact string true", () => {
      expect(resolveLeadFeeRefundConfig({ LEAD_FEE_REFUND_REAL_REFUNDS_ENABLED: "true" })).toEqual({ status: "VALID", realRefundsEnabled: true, automaticTechnicalRefundsEnabled: false });
    });
    it.each(["TRUE", "1", "yes", "on", "enabled", "tru"])("treats malformed value %s as INVALID (blocks)", (value) => {
      expect(resolveLeadFeeRefundConfig({ LEAD_FEE_REFUND_REAL_REFUNDS_ENABLED: value }).status).toBe("INVALID");
      expect(resolveLeadFeeRefundConfig({ LEAD_FEE_REFUND_REAL_REFUNDS_ENABLED: "true", LEAD_FEE_REFUND_AUTOMATIC_TECHNICAL_ENABLED: value }).status).toBe("INVALID");
    });
    it("the automatic switch requires the master switch", () => {
      expect(resolveLeadFeeRefundConfig({ LEAD_FEE_REFUND_AUTOMATIC_TECHNICAL_ENABLED: "true" }).status).toBe("INVALID");
      const both = resolveLeadFeeRefundConfig({ LEAD_FEE_REFUND_REAL_REFUNDS_ENABLED: "true", LEAD_FEE_REFUND_AUTOMATIC_TECHNICAL_ENABLED: "true" });
      expect(isAutomaticTechnicalRefundAllowed(both)).toBe(true);
      expect(isAutomaticTechnicalRefundAllowed(resolveLeadFeeRefundConfig({ LEAD_FEE_REFUND_REAL_REFUNDS_ENABLED: "true" }))).toBe(false);
      expect(isAutomaticTechnicalRefundAllowed(resolveLeadFeeRefundConfig({}))).toBe(false);
      expect(isAutomaticTechnicalRefundAllowed({ status: "INVALID" })).toBe(false);
    });
  });

  describe("input rules", () => {
    it("trims the explanation and keeps 1..1000 characters (no truncation)", () => {
      expect(normalizeLeadFeeRefundExplanation("  A defect blocked the paid access.  ")).toBe("A defect blocked the paid access.");
      expect(normalizeLeadFeeRefundExplanation("x".repeat(1000))).toHaveLength(1000);
      expect(reason(() => normalizeLeadFeeRefundExplanation("x".repeat(1001)))).toBe("INVALID_INPUT");
      expect(reason(() => normalizeLeadFeeRefundExplanation("   "))).toBe("INVALID_INPUT");
      expect(reason(() => normalizeLeadFeeRefundExplanation(undefined))).toBe("INVALID_INPUT");
    });
    it.each(["contact me at ana@example.com", "call 612 345 678 please", "see https://x.example/abc", "see www.example.com"])("rejects obvious personal data (%s)", (text) => {
      expect(reason(() => normalizeLeadFeeRefundExplanation(text))).toBe("INVALID_INPUT");
    });
    it("evidence reference is a separate, opaque, non-empty id", () => {
      expect(normalizeLeadFeeRefundEvidenceReference(" INC-2026-1042 ")).toBe("INC-2026-1042");
      for (const bad of ["", "   ", "has space", "a".repeat(201), 5]) expect(reason(() => normalizeLeadFeeRefundEvidenceReference(bad))).toBe("INVALID_INPUT");
    });
    it("provider references are opaque ids", () => {
      expect(normalizeLeadFeeRefundProviderReference("pi_3Abc")).toBe("pi_3Abc");
      for (const bad of ["", "pi 1", "pi_1;drop", 3]) expect(reason(() => normalizeLeadFeeRefundProviderReference(bad))).toBe("INVALID_INPUT");
    });
  });

  describe("status machine (mirrors the DB trigger)", () => {
    it("SUCCEEDED and FAILED are terminal; nothing returns to REQUESTED", () => {
      expect(LEAD_FEE_REFUND_TRANSITIONS.SUCCEEDED).toEqual([]);
      expect(LEAD_FEE_REFUND_TRANSITIONS.FAILED).toEqual([]);
      for (const from of LEAD_FEE_REFUND_STATUSES) expect(canTransitionLeadFeeRefund(from, "REQUESTED")).toBe(false);
      expect(canTransitionLeadFeeRefund("UNKNOWN", "SUCCEEDED")).toBe(true);
      expect(canTransitionLeadFeeRefund("PROVIDER_PENDING", "UNKNOWN")).toBe(false);
    });
    it("a succeeded refund still counts as ACTIVE (it is never refunded again)", () => {
      expect([...LEAD_FEE_REFUND_ACTIVE_STATUSES]).toContain("SUCCEEDED");
      expect([...LEAD_FEE_REFUND_ACTIVE_STATUSES]).not.toContain("FAILED");
    });
    it("idempotency keys are per payment AND attempt", () => {
      expect(leadFeeRefundIdempotencyKey("pi_1", 1)).not.toBe(leadFeeRefundIdempotencyKey("pi_1", 2));
      expect(leadFeeRefundIdempotencyKey("pi_1", 1)).toBe(leadFeeRefundIdempotencyKey("pi_1", 1));
    });
  });

  describe("refundable payment facts", () => {
    const expected = { purchaseId: "p1", totalMinorUnits: 2178, currency: "EUR" };
    const ok: LeadFeeRefundablePaymentFacts = {
      succeeded: true,
      amountMinorUnits: 2178,
      amountReceivedMinorUnits: 2178,
      amountRefundedMinorUnits: 0,
      refunded: false,
      disputed: false,
      currency: "EUR",
      purchaseId: "p1",
    };
    it("accepts a succeeded, undisputed, unrefunded charge of exactly the snapshot total", () => {
      expect(reason(() => assertLeadFeeRefundablePayment(ok, expected))).toBeNull();
    });
    it.each([
      ["PAYMENT_NOT_SUCCEEDED", { succeeded: false }],
      ["AMOUNT_MISMATCH", { amountMinorUnits: 2179 }],
      ["AMOUNT_MISMATCH", { amountReceivedMinorUnits: 2000 }],
      ["CURRENCY_MISMATCH", { currency: "USD" }],
      ["PAYMENT_NOT_ASSOCIATED", { purchaseId: "other" }],
      ["PAYMENT_NOT_ASSOCIATED", { purchaseId: null }],
      ["PAYMENT_DISPUTED", { disputed: true }],
      ["ALREADY_REFUNDED", { amountRefundedMinorUnits: 100 }],
      ["ALREADY_REFUNDED", { refunded: true }],
    ])("fails closed with %s", (expectedReason, patch) => {
      expect(reason(() => assertLeadFeeRefundablePayment({ ...ok, ...patch }, expected))).toBe(expectedReason);
    });
  });

  it("only definitive provider rejections count as failure; timeouts / network / unknown never do", () => {
    const definitive: PaymentGatewayErrorCategory[] = ["INVALID_REQUEST", "AUTHENTICATION", "NOT_FOUND"];
    const notDefinitive: PaymentGatewayErrorCategory[] = ["NETWORK", "TEMPORARY", "RATE_LIMITED", "UNKNOWN", "CARD_DECLINED", "NOT_IMPLEMENTED"];
    for (const c of definitive) expect(isDefinitiveLeadFeeRefundRejection(c)).toBe(true);
    for (const c of notDefinitive) expect(isDefinitiveLeadFeeRefundRejection(c)).toBe(false);
    expect(new PaymentGatewayError("NETWORK", "x", true).category).toBe("NETWORK");
  });
});
