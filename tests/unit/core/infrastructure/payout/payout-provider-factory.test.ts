import { beforeEach, describe, expect, it } from "vitest";

import { __testing, getPayoutProvider } from "@/infrastructure/payout/payout-provider-factory";
import { IbanPayoutProvider } from "@/infrastructure/payout/iban-payout-provider";
import { StripeExpressPayoutProvider } from "@/infrastructure/payout/stripe-express-payout-provider";

describe("payout-provider-factory (Module 62)", () => {
  beforeEach(() => {
    __testing.reset();
  });

  it("resolves IBAN to an IbanPayoutProvider", () => {
    expect(getPayoutProvider("IBAN")).toBeInstanceOf(IbanPayoutProvider);
  });

  it("resolves STRIPE_EXPRESS to a StripeExpressPayoutProvider", () => {
    expect(getPayoutProvider("STRIPE_EXPRESS")).toBeInstanceOf(StripeExpressPayoutProvider);
  });

  it("memoizes one instance per method", () => {
    expect(getPayoutProvider("IBAN")).toBe(getPayoutProvider("IBAN"));
  });

  it("returns distinct instances per method", () => {
    expect(getPayoutProvider("IBAN")).not.toBe(getPayoutProvider("STRIPE_EXPRESS"));
  });

  it("__testing.reset() forces a fresh instance", () => {
    const first = getPayoutProvider("IBAN");
    __testing.reset();
    const second = getPayoutProvider("IBAN");
    expect(second).not.toBe(first);
  });
});
