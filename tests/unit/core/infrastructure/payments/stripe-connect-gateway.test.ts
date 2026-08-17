import Stripe from "stripe";
import { describe, expect, it, vi } from "vitest";

import { StripeConnectGatewayAdapter } from "@/infrastructure/payments/stripe/stripe-connect-gateway";

/**
 * Module 71 — Stripe Connect.
 *
 * Unit tests for `StripeConnectGatewayAdapter` against a hand-built fake
 * Stripe SDK object — no network call, no real Stripe credentials, same
 * "fake the SDK client" convention `persona-verification-provider.test.ts`
 * uses for `PersonaClient`.
 */
function fakeStripe(overrides: Partial<Stripe> = {}): Stripe {
  return {
    accounts: {
      create: vi.fn(),
      retrieve: vi.fn(),
      createLoginLink: vi.fn(),
    },
    accountLinks: {
      create: vi.fn(),
    },
    ...overrides,
  } as unknown as Stripe;
}

describe("StripeConnectGatewayAdapter (Module 71)", () => {
  describe("createConnectedAccount", () => {
    it("creates an Express account with a deterministic idempotency key", async () => {
      const stripe = fakeStripe();
      (stripe.accounts.create as ReturnType<typeof vi.fn>).mockResolvedValue({ id: "acct_123" });
      const adapter = new StripeConnectGatewayAdapter(stripe);

      const result = await adapter.createConnectedAccount({
        professionalProfileId: "pro-1",
        email: "pro@example.com",
        country: "ES",
      });

      expect(result.stripeAccountId).toBe("acct_123");
      expect(stripe.accounts.create).toHaveBeenCalledWith(
        expect.objectContaining({ type: "express", country: "ES", email: "pro@example.com" }),
        { idempotencyKey: "connect-account:pro-1" },
      );
    });

    it("requests only the transfers capability, never card_payments", async () => {
      const stripe = fakeStripe();
      (stripe.accounts.create as ReturnType<typeof vi.fn>).mockResolvedValue({ id: "acct_123" });
      const adapter = new StripeConnectGatewayAdapter(stripe);

      await adapter.createConnectedAccount({ professionalProfileId: "pro-1", email: null, country: "ES" });

      const createMock = stripe.accounts.create as unknown as ReturnType<typeof vi.fn>;
      const [payload] = createMock.mock.calls[0] as [Record<string, unknown>];
      expect(payload.capabilities).toEqual({ transfers: { requested: true } });
      expect(payload.capabilities).not.toHaveProperty("card_payments");
    });

    it("never sends the platform's commission or any money amount to Stripe", async () => {
      const stripe = fakeStripe();
      (stripe.accounts.create as ReturnType<typeof vi.fn>).mockResolvedValue({ id: "acct_123" });
      const adapter = new StripeConnectGatewayAdapter(stripe);

      await adapter.createConnectedAccount({ professionalProfileId: "pro-1", email: null, country: "ES" });

      const createMock = stripe.accounts.create as unknown as ReturnType<typeof vi.fn>;
      const [payload] = createMock.mock.calls[0] as [Record<string, unknown>];
      expect(payload).not.toHaveProperty("amount");
      expect(payload).not.toHaveProperty("commission");
    });
  });

  describe("createOnboardingLink", () => {
    it("maps Stripe's account link into the port's DTO", async () => {
      const stripe = fakeStripe();
      const expiresAt = Math.floor(Date.now() / 1000) + 300;
      (stripe.accountLinks.create as ReturnType<typeof vi.fn>).mockResolvedValue({
        url: "https://connect.stripe.com/setup/e/acct_123",
        expires_at: expiresAt,
      });
      const adapter = new StripeConnectGatewayAdapter(stripe);

      const result = await adapter.createOnboardingLink("acct_123", {
        refreshUrl: "https://maestroya.example/refresh",
        returnUrl: "https://maestroya.example/return",
      });

      expect(result.url).toBe("https://connect.stripe.com/setup/e/acct_123");
      expect(result.expiresAt.getTime()).toBe(expiresAt * 1000);
    });
  });

  describe("retrieveAccountStatus", () => {
    it("maps Stripe's own capability flags verbatim, never deriving a different meaning", async () => {
      const stripe = fakeStripe();
      (stripe.accounts.retrieve as ReturnType<typeof vi.fn>).mockResolvedValue({
        id: "acct_123",
        details_submitted: true,
        capabilities: { transfers: "active" },
        payouts_enabled: false,
        requirements: { currently_due: ["individual.verification.document"], disabled_reason: null },
      });
      const adapter = new StripeConnectGatewayAdapter(stripe);

      const result = await adapter.retrieveAccountStatus("acct_123");

      expect(result).toEqual({
        stripeAccountId: "acct_123",
        detailsSubmitted: true,
        transfersActive: true,
        payoutsEnabled: false,
        requirementsCurrentlyDue: ["individual.verification.document"],
        disabledReason: null,
      });
    });

    it("reports transfersActive: false when Stripe's transfers capability is inactive/pending/disabled", async () => {
      const stripe = fakeStripe();
      (stripe.accounts.retrieve as ReturnType<typeof vi.fn>).mockResolvedValue({
        id: "acct_123",
        details_submitted: true,
        capabilities: { transfers: "inactive" },
        payouts_enabled: true,
        requirements: { currently_due: [], disabled_reason: "requirements.past_due" },
      });
      const adapter = new StripeConnectGatewayAdapter(stripe);

      const result = await adapter.retrieveAccountStatus("acct_123");

      expect(result.transfersActive).toBe(false);
      expect(result.payoutsEnabled).toBe(true);
      expect(result.disabledReason).toBe("requirements.past_due");
    });

    it("defaults requirementsCurrentlyDue to an empty array when Stripe omits requirements", async () => {
      const stripe = fakeStripe();
      (stripe.accounts.retrieve as ReturnType<typeof vi.fn>).mockResolvedValue({
        id: "acct_123",
        details_submitted: false,
        payouts_enabled: false,
      });
      const adapter = new StripeConnectGatewayAdapter(stripe);

      const result = await adapter.retrieveAccountStatus("acct_123");
      expect(result.transfersActive).toBe(false);
      expect(result.requirementsCurrentlyDue).toEqual([]);
      expect(result.disabledReason).toBeNull();
    });
  });

  describe("createLoginLink", () => {
    it("maps Stripe's login link into the port's DTO", async () => {
      const stripe = fakeStripe();
      (stripe.accounts.createLoginLink as ReturnType<typeof vi.fn>).mockResolvedValue({
        url: "https://connect.stripe.com/express/acct_123",
      });
      const adapter = new StripeConnectGatewayAdapter(stripe);

      const result = await adapter.createLoginLink("acct_123");
      expect(result.url).toBe("https://connect.stripe.com/express/acct_123");
    });
  });

  describe("error mapping", () => {
    it("maps StripeAuthenticationError to a non-retryable AUTHENTICATION StripeConnectError", async () => {
      const stripe = fakeStripe();
      const err = new Stripe.errors.StripeAuthenticationError({
        type: "authentication_error",
        message: "Invalid API key",
      } as never);
      (stripe.accounts.retrieve as ReturnType<typeof vi.fn>).mockRejectedValue(err);
      const adapter = new StripeConnectGatewayAdapter(stripe);

      await expect(adapter.retrieveAccountStatus("acct_123")).rejects.toMatchObject({
        code: "STRIPE_CONNECT_ERROR",
        category: "AUTHENTICATION",
        retryable: false,
      });
    });

    it("maps a resource_missing StripeInvalidRequestError to NOT_FOUND", async () => {
      const stripe = fakeStripe();
      const err = new Stripe.errors.StripeInvalidRequestError({
        type: "invalid_request_error",
        code: "resource_missing",
        message: "No such account",
      } as never);
      (stripe.accounts.retrieve as ReturnType<typeof vi.fn>).mockRejectedValue(err);
      const adapter = new StripeConnectGatewayAdapter(stripe);

      await expect(adapter.retrieveAccountStatus("acct_missing")).rejects.toMatchObject({
        category: "NOT_FOUND",
        retryable: false,
      });
    });

    it("maps other StripeInvalidRequestError codes to INVALID_REQUEST", async () => {
      const stripe = fakeStripe();
      const err = new Stripe.errors.StripeInvalidRequestError({
        type: "invalid_request_error",
        code: "parameter_invalid_empty",
        message: "Missing required param",
      } as never);
      (stripe.accounts.create as ReturnType<typeof vi.fn>).mockRejectedValue(err);
      const adapter = new StripeConnectGatewayAdapter(stripe);

      await expect(
        adapter.createConnectedAccount({ professionalProfileId: "pro-1", email: null, country: "ES" }),
      ).rejects.toMatchObject({ category: "INVALID_REQUEST", retryable: false });
    });

    it("maps StripeRateLimitError to a retryable RATE_LIMITED error", async () => {
      const stripe = fakeStripe();
      const err = new Stripe.errors.StripeRateLimitError({
        type: "rate_limit_error",
        message: "Too many requests",
      } as never);
      (stripe.accounts.create as ReturnType<typeof vi.fn>).mockRejectedValue(err);
      const adapter = new StripeConnectGatewayAdapter(stripe);

      await expect(
        adapter.createConnectedAccount({ professionalProfileId: "pro-1", email: null, country: "ES" }),
      ).rejects.toMatchObject({ category: "RATE_LIMITED", retryable: true });
    });

    it("maps StripeConnectionError to a retryable NETWORK error", async () => {
      const stripe = fakeStripe();
      const err = new Stripe.errors.StripeConnectionError({
        type: "api_connection_error",
        message: "Network unreachable",
      } as never);
      (stripe.accounts.retrieve as ReturnType<typeof vi.fn>).mockRejectedValue(err);
      const adapter = new StripeConnectGatewayAdapter(stripe);

      await expect(adapter.retrieveAccountStatus("acct_123")).rejects.toMatchObject({
        category: "NETWORK",
        retryable: true,
      });
    });

    it("maps a generic StripeAPIError to a retryable TEMPORARY error", async () => {
      const stripe = fakeStripe();
      const err = new Stripe.errors.StripeAPIError({
        type: "api_error",
        message: "Internal error",
      } as never);
      (stripe.accountLinks.create as ReturnType<typeof vi.fn>).mockRejectedValue(err);
      const adapter = new StripeConnectGatewayAdapter(stripe);

      await expect(
        adapter.createOnboardingLink("acct_123", { refreshUrl: "https://x", returnUrl: "https://y" }),
      ).rejects.toMatchObject({ category: "TEMPORARY", retryable: true });
    });

    it("maps a non-Stripe error to UNKNOWN, non-retryable", async () => {
      const stripe = fakeStripe();
      (stripe.accounts.createLoginLink as ReturnType<typeof vi.fn>).mockRejectedValue(new Error("boom"));
      const adapter = new StripeConnectGatewayAdapter(stripe);

      await expect(adapter.createLoginLink("acct_123")).rejects.toMatchObject({
        category: "UNKNOWN",
        retryable: false,
      });
    });

    it("maps StripePermissionError to a non-retryable ACCOUNT_RESTRICTED error", async () => {
      const stripe = fakeStripe();
      const err = new Stripe.errors.StripePermissionError({
        type: "invalid_request_error",
        message: "This API key does not have permissions for this connected account",
      } as never);
      (stripe.accounts.retrieve as ReturnType<typeof vi.fn>).mockRejectedValue(err);
      const adapter = new StripeConnectGatewayAdapter(stripe);

      await expect(adapter.retrieveAccountStatus("acct_123")).rejects.toMatchObject({
        category: "ACCOUNT_RESTRICTED",
        retryable: false,
      });
    });

    it("maps a StripeCardError to a non-retryable UNKNOWN error (not expected on Connect account calls, but must not leak)", async () => {
      const stripe = fakeStripe();
      const err = new Stripe.errors.StripeCardError({
        type: "card_error",
        code: "card_declined",
        message: "Your card was declined.",
      } as never);
      (stripe.accounts.create as ReturnType<typeof vi.fn>).mockRejectedValue(err);
      const adapter = new StripeConnectGatewayAdapter(stripe);

      await expect(
        adapter.createConnectedAccount({ professionalProfileId: "pro-1", email: null, country: "ES" }),
      ).rejects.toMatchObject({ category: "UNKNOWN", retryable: false });
    });

    it("never leaks a raw Stripe SDK error type past the adapter", async () => {
      const stripe = fakeStripe();
      const err = new Stripe.errors.StripeAuthenticationError({
        type: "authentication_error",
        message: "Invalid API key",
      } as never);
      (stripe.accounts.create as ReturnType<typeof vi.fn>).mockRejectedValue(err);
      const adapter = new StripeConnectGatewayAdapter(stripe);

      try {
        await adapter.createConnectedAccount({ professionalProfileId: "pro-1", email: null, country: "ES" });
        expect.fail("expected createConnectedAccount to throw");
      } catch (thrown) {
        expect(thrown).not.toBeInstanceOf(Stripe.errors.StripeError);
        expect((thrown as Error).name).toBe("StripeConnectError");
      }
    });
  });
});
