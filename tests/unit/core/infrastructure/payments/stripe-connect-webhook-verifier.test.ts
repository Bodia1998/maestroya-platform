import Stripe from "stripe";
import { describe, expect, it, vi } from "vitest";

import { StripeConnectWebhookVerifierAdapter } from "@/infrastructure/payments/stripe/stripe-connect-webhook-verifier";

/**
 * Module 72 — Stripe Webhooks.
 *
 * Unit tests for `StripeConnectWebhookVerifierAdapter` against a
 * hand-built fake Stripe SDK object — no network call, no real Stripe
 * credentials, same "fake the SDK client" convention
 * `stripe-connect-gateway.test.ts` (Module 71) already uses.
 */
function fakeStripe(constructEvent: (...args: unknown[]) => Stripe.Event): Stripe {
  return {
    webhooks: {
      constructEvent: vi.fn(constructEvent),
    },
  } as unknown as Stripe;
}

function fakeAccountUpdatedEvent(overrides: Partial<Stripe.Account> = {}): Stripe.Event {
  return {
    id: "evt_1",
    object: "event",
    type: "account.updated",
    account: "acct_1",
    created: 1735689600, // 2025-01-01T00:00:00Z
    data: {
      object: {
        id: "acct_1",
        object: "account",
        details_submitted: true,
        payouts_enabled: true,
        capabilities: { transfers: "active" },
        requirements: { currently_due: [], disabled_reason: null },
        ...overrides,
      } as unknown as Stripe.Account,
    },
  } as unknown as Stripe.Event;
}

describe("StripeConnectWebhookVerifierAdapter (Module 72)", () => {
  describe("signature verification", () => {
    it("accepts a validly-signed payload and returns the parsed event", () => {
      const stripe = fakeStripe(() => fakeAccountUpdatedEvent());
      const adapter = new StripeConnectWebhookVerifierAdapter(stripe, "whsec_test");

      const result = adapter.verify("{}", "t=1,v1=validsig");

      expect(result.valid).toBe(true);
      if (result.valid) {
        expect(result.event.id).toBe("evt_1");
        expect(result.event.type).toBe("account.updated");
      }
      expect(stripe.webhooks.constructEvent).toHaveBeenCalledWith("{}", "t=1,v1=validsig", "whsec_test");
    });

    it("rejects an invalid signature without throwing", () => {
      const stripe = fakeStripe(() => {
        throw new Stripe.errors.StripeSignatureVerificationError({
          message: "No signatures found matching the expected signature for payload",
        } as never);
      });
      const adapter = new StripeConnectWebhookVerifierAdapter(stripe, "whsec_test");

      const result = adapter.verify("{}", "t=1,v1=deadbeef");

      expect(result.valid).toBe(false);
    });

    it("rejects a malformed (non-JSON) payload without throwing", () => {
      const stripe = fakeStripe(() => {
        throw new SyntaxError("Unexpected token in JSON");
      });
      const adapter = new StripeConnectWebhookVerifierAdapter(stripe, "whsec_test");

      const result = adapter.verify("not-json", "t=1,v1=validsig");

      expect(result.valid).toBe(false);
    });

    it("rejects when no signature header is present at all, without even calling the SDK", () => {
      const stripe = fakeStripe(() => fakeAccountUpdatedEvent());
      const adapter = new StripeConnectWebhookVerifierAdapter(stripe, "whsec_test");

      const result = adapter.verify("{}", null);

      expect(result.valid).toBe(false);
      expect(stripe.webhooks.constructEvent).not.toHaveBeenCalled();
    });

    it("never leaks the webhook secret in its return value", () => {
      const stripe = fakeStripe(() => fakeAccountUpdatedEvent());
      const adapter = new StripeConnectWebhookVerifierAdapter(stripe, "whsec_super_secret");

      const result = adapter.verify("{}", "t=1,v1=validsig");

      expect(JSON.stringify(result)).not.toContain("whsec_super_secret");
    });
  });

  describe("account.updated mapping", () => {
    it("maps a fully-onboarded account onto the provider-agnostic payload", () => {
      const stripe = fakeStripe(() => fakeAccountUpdatedEvent());
      const adapter = new StripeConnectWebhookVerifierAdapter(stripe, "whsec_test");

      const result = adapter.verify("{}", "t=1,v1=validsig");

      expect(result.valid).toBe(true);
      if (!result.valid) return;
      expect(result.event.accountUpdated).toEqual({
        stripeAccountId: "acct_1",
        detailsSubmitted: true,
        transfersActive: true,
        payoutsEnabled: true,
        requirementsCurrentlyDue: [],
        disabledReason: null,
      });
      expect(result.event.createdAt).toEqual(new Date(1735689600 * 1000));
    });

    it("reads the connected account id from event.account, per Stripe's own Connect webhook documentation", () => {
      const event = fakeAccountUpdatedEvent();
      // Simulate `data.object.id` disagreeing with `event.account` (should
      // never happen in practice, but proves this adapter trusts the
      // documented `event.account` field, not `data.object.id`).
      (event.data.object as unknown as { id: string }).id = "acct_different";
      const stripe = fakeStripe(() => event);
      const adapter = new StripeConnectWebhookVerifierAdapter(stripe, "whsec_test");

      const result = adapter.verify("{}", "t=1,v1=validsig");

      expect(result.valid).toBe(true);
      if (result.valid) expect(result.event.accountUpdated?.stripeAccountId).toBe("acct_1");
    });

    it("reports transfersActive false when the transfers capability is not active", () => {
      const event = fakeAccountUpdatedEvent();
      (event.data.object as unknown as { capabilities: unknown }).capabilities = { transfers: "pending" };
      const stripe = fakeStripe(() => event);
      const adapter = new StripeConnectWebhookVerifierAdapter(stripe, "whsec_test");

      const result = adapter.verify("{}", "t=1,v1=validsig");

      expect(result.valid).toBe(true);
      if (result.valid) expect(result.event.accountUpdated?.transfersActive).toBe(false);
    });

    it("surfaces requirements.currently_due entries as-is for observability", () => {
      const event = fakeAccountUpdatedEvent({
        requirements: { currently_due: ["individual.verification.document"], disabled_reason: "requirements.past_due" },
      } as never);
      const stripe = fakeStripe(() => event);
      const adapter = new StripeConnectWebhookVerifierAdapter(stripe, "whsec_test");

      const result = adapter.verify("{}", "t=1,v1=validsig");

      expect(result.valid).toBe(true);
      if (result.valid) {
        expect(result.event.accountUpdated?.requirementsCurrentlyDue).toEqual(["individual.verification.document"]);
        expect(result.event.accountUpdated?.disabledReason).toBe("requirements.past_due");
      }
    });

    it("returns accountUpdated: null for a validly-signed event of a different type", () => {
      const stripe = fakeStripe(
        () =>
          ({
            id: "evt_2",
            object: "event",
            type: "capability.updated",
            account: "acct_1",
            created: 1735689600,
            data: { object: {} },
          }) as unknown as Stripe.Event,
      );
      const adapter = new StripeConnectWebhookVerifierAdapter(stripe, "whsec_test");

      const result = adapter.verify("{}", "t=1,v1=validsig");

      expect(result.valid).toBe(true);
      if (result.valid) {
        expect(result.event.type).toBe("capability.updated");
        expect(result.event.accountUpdated).toBeNull();
      }
    });
  });

  describe("transfer.created extraction (Module 76)", () => {
    function fakeTransferCreatedEvent(overrides: Record<string, unknown> = {}): Stripe.Event {
      return {
        id: "evt_transfer_1",
        object: "event",
        type: "transfer.created",
        account: "acct_1",
        created: 1735689600,
        data: {
          object: {
            id: "tr_1",
            object: "transfer",
            destination: "acct_1",
            metadata: { payoutId: "payout-1", jobId: "job-1" },
            ...overrides,
          },
        },
      } as unknown as Stripe.Event;
    }

    it("extracts stripeTransferId, destination, and payoutId metadata", () => {
      const stripe = fakeStripe(() => fakeTransferCreatedEvent());
      const adapter = new StripeConnectWebhookVerifierAdapter(stripe, "whsec_test");

      const result = adapter.verify("{}", "t=1,v1=validsig");

      expect(result.valid).toBe(true);
      if (result.valid) {
        expect(result.event.transferCreated).toEqual({
          stripeTransferId: "tr_1",
          destinationStripeAccountId: "acct_1",
          payoutId: "payout-1",
        });
        expect(result.event.accountUpdated).toBeNull();
      }
    });

    it("yields payoutId: null for a transfer with no recognizable metadata", () => {
      const stripe = fakeStripe(() => fakeTransferCreatedEvent({ metadata: {} }));
      const adapter = new StripeConnectWebhookVerifierAdapter(stripe, "whsec_test");

      const result = adapter.verify("{}", "t=1,v1=validsig");

      expect(result.valid).toBe(true);
      if (result.valid) {
        expect(result.event.transferCreated?.payoutId).toBeNull();
      }
    });

    it("returns transferCreated: null for a validly-signed event of a different type", () => {
      const stripe = fakeStripe(() => fakeAccountUpdatedEvent());
      const adapter = new StripeConnectWebhookVerifierAdapter(stripe, "whsec_test");

      const result = adapter.verify("{}", "t=1,v1=validsig");

      expect(result.valid).toBe(true);
      if (result.valid) {
        expect(result.event.transferCreated).toBeNull();
      }
    });
  });
});
