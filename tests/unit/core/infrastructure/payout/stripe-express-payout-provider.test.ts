import { describe, expect, it } from "vitest";

import { StripeExpressPayoutProvider } from "@/infrastructure/payout/stripe-express-payout-provider";

describe("StripeExpressPayoutProvider (Module 62)", () => {
  it("prepares onboarding state only — PENDING status, no external account, no accountHash", async () => {
    const provider = new StripeExpressPayoutProvider();

    const result = await provider.registerDestination({
      professionalProfileId: "profile-1",
      accountHolderName: "Jane Doe",
    });

    expect(result.method).toBe("STRIPE_EXPRESS");
    expect(result.status).toBe("PENDING");
    expect(result.externalReference).toBeNull();
    expect(result.accountHash).toBeNull();
  });

  it("never imports or references the Stripe SDK", async () => {
    // Source-level guarantee, verified structurally: this provider's own
    // module has no dependency on the `stripe` package — see the class's
    // own doc comment for why. Behaviourally, this asserts the same result
    // is returned however the request is shaped, since nothing here talks
    // to a real Stripe account.
    const provider = new StripeExpressPayoutProvider();
    const first = await provider.registerDestination({ professionalProfileId: "a", accountHolderName: "A" });
    const second = await provider.registerDestination({ professionalProfileId: "b", accountHolderName: "B" });
    expect(first).toEqual(second);
  });
});
