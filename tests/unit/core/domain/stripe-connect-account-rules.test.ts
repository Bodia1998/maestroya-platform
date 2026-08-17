import { describe, expect, it } from "vitest";

import {
  deriveStripeExpressReadiness,
  isStripePayoutEligible,
} from "@/domain/services/stripe-connect-account-rules";

describe("stripe-connect-account-rules (Module 71)", () => {
  describe("isStripePayoutEligible", () => {
    it("is eligible only when both transfers are active and payouts are enabled", () => {
      expect(
        isStripePayoutEligible({
          detailsSubmitted: true,
          transfersActive: true,
          payoutsEnabled: true,
          requirementsCurrentlyDue: false,
        }),
      ).toBe(true);
    });

    it("is not eligible when payouts are disabled even if transfers are active", () => {
      expect(
        isStripePayoutEligible({
          detailsSubmitted: true,
          transfersActive: true,
          payoutsEnabled: false,
          requirementsCurrentlyDue: false,
        }),
      ).toBe(false);
    });

    it("is not eligible when the transfers capability is inactive/disabled even if payouts are enabled", () => {
      expect(
        isStripePayoutEligible({
          detailsSubmitted: true,
          transfersActive: false,
          payoutsEnabled: true,
          requirementsCurrentlyDue: false,
        }),
      ).toBe(false);
    });

    it("ignores detailsSubmitted/requirementsCurrentlyDue entirely", () => {
      expect(
        isStripePayoutEligible({
          detailsSubmitted: false,
          transfersActive: true,
          payoutsEnabled: true,
          requirementsCurrentlyDue: true,
        }),
      ).toBe(true);
    });

    it("is not eligible when both transfers are inactive and payouts are disabled", () => {
      expect(
        isStripePayoutEligible({
          detailsSubmitted: false,
          transfersActive: false,
          payoutsEnabled: false,
          requirementsCurrentlyDue: false,
        }),
      ).toBe(false);
    });
  });

  describe("deriveStripeExpressReadiness", () => {
    it("is READY only when detailsSubmitted, transfersActive and payoutsEnabled are all true", () => {
      expect(
        deriveStripeExpressReadiness({
          detailsSubmitted: true,
          transfersActive: true,
          payoutsEnabled: true,
          requirementsCurrentlyDue: false,
        }),
      ).toBe("READY");
    });

    it("is READY even when requirementsCurrentlyDue is true, as long as transfers/payouts are already active (non-blocking 'eventually due' requirements)", () => {
      expect(
        deriveStripeExpressReadiness({
          detailsSubmitted: true,
          transfersActive: true,
          payoutsEnabled: true,
          requirementsCurrentlyDue: true,
        }),
      ).toBe("READY");
    });

    it("is PENDING when details have not been submitted yet", () => {
      expect(
        deriveStripeExpressReadiness({
          detailsSubmitted: false,
          transfersActive: true,
          payoutsEnabled: true,
          requirementsCurrentlyDue: false,
        }),
      ).toBe("PENDING");
    });

    it("is PENDING when the transfers capability is not yet active", () => {
      expect(
        deriveStripeExpressReadiness({
          detailsSubmitted: true,
          transfersActive: false,
          payoutsEnabled: true,
          requirementsCurrentlyDue: false,
        }),
      ).toBe("PENDING");
    });

    it("is PENDING when payouts are not yet enabled", () => {
      expect(
        deriveStripeExpressReadiness({
          detailsSubmitted: true,
          transfersActive: true,
          payoutsEnabled: false,
          requirementsCurrentlyDue: false,
        }),
      ).toBe("PENDING");
    });

    it("is PENDING when the transfers capability has been disabled after previously being active", () => {
      expect(
        deriveStripeExpressReadiness({
          detailsSubmitted: true,
          transfersActive: false,
          payoutsEnabled: false,
          requirementsCurrentlyDue: true,
        }),
      ).toBe("PENDING");
    });
  });
});
