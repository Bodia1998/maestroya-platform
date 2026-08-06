import { describe, expect, it } from "vitest";

import {
  PAYMENT_STATUSES,
  canTransitionPaymentStatus,
  isPaymentStatus,
  isTerminalPaymentStatus,
  type PaymentStatus,
} from "@/domain/value-objects/payment-status";

describe("domain/value-objects/payment-status", () => {
  describe("isPaymentStatus", () => {
    it("accepts every declared status", () => {
      for (const status of PAYMENT_STATUSES) {
        expect(isPaymentStatus(status)).toBe(true);
      }
    });

    it("rejects unknown strings and non-strings", () => {
      expect(isPaymentStatus("SETTLED")).toBe(false);
      expect(isPaymentStatus("pending")).toBe(false);
      expect(isPaymentStatus(null)).toBe(false);
      expect(isPaymentStatus(undefined)).toBe(false);
      expect(isPaymentStatus(42)).toBe(false);
    });
  });

  describe("isTerminalPaymentStatus", () => {
    it("treats FAILED, CANCELLED, and REFUNDED as terminal", () => {
      expect(isTerminalPaymentStatus("FAILED")).toBe(true);
      expect(isTerminalPaymentStatus("CANCELLED")).toBe(true);
      expect(isTerminalPaymentStatus("REFUNDED")).toBe(true);
    });

    it("treats PENDING, AUTHORIZED, CAPTURED, and PARTIALLY_REFUNDED as non-terminal", () => {
      expect(isTerminalPaymentStatus("PENDING")).toBe(false);
      expect(isTerminalPaymentStatus("AUTHORIZED")).toBe(false);
      expect(isTerminalPaymentStatus("CAPTURED")).toBe(false);
      expect(isTerminalPaymentStatus("PARTIALLY_REFUNDED")).toBe(false);
    });
  });

  describe("canTransitionPaymentStatus", () => {
    const allowed: [PaymentStatus, PaymentStatus][] = [
      ["PENDING", "AUTHORIZED"],
      ["PENDING", "CAPTURED"],
      ["PENDING", "FAILED"],
      ["PENDING", "CANCELLED"],
      ["AUTHORIZED", "CAPTURED"],
      ["AUTHORIZED", "FAILED"],
      ["AUTHORIZED", "CANCELLED"],
    ];

    it.each(allowed)("allows %s -> %s", (from, to) => {
      expect(canTransitionPaymentStatus(from, to)).toBe(true);
    });

    const disallowed: [PaymentStatus, PaymentStatus][] = [
      ["CAPTURED", "AUTHORIZED"],
      ["CAPTURED", "PENDING"],
      ["FAILED", "CAPTURED"],
      ["CANCELLED", "CAPTURED"],
      ["REFUNDED", "CAPTURED"],
      ["AUTHORIZED", "PENDING"],
      ["PENDING", "PENDING"],
      ["PENDING", "REFUNDED"],
      ["PENDING", "PARTIALLY_REFUNDED"],
    ];

    it.each(disallowed)("disallows %s -> %s", (from, to) => {
      expect(canTransitionPaymentStatus(from, to)).toBe(false);
    });

    it("every status has an entry in the transition graph (no status is unreachably undefined)", () => {
      for (const status of PAYMENT_STATUSES) {
        expect(() => canTransitionPaymentStatus(status, status)).not.toThrow();
      }
    });
  });
});
