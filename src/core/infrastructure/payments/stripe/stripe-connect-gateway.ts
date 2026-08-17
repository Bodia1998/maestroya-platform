import "server-only";

import Stripe from "stripe";

import { StripeConnectError, type StripeConnectErrorCategory } from "@/domain/errors/domain-error";
import type {
  CreateConnectedAccountRequest,
  CreateConnectedAccountResult,
  CreateLoginLinkResult,
  CreateOnboardingLinkOptions,
  CreateOnboardingLinkResult,
  StripeAccountStatusResult,
  StripeConnectGateway,
} from "@/application/ports/stripe-connect-gateway";

/**
 * Module 71 — Stripe Connect.
 *
 * `StripeConnectGateway` implementation backed by the Stripe SDK's
 * Connect resources (`accounts`, `accountLinks`, `accounts.
 * createLoginLink`). The only file in this module that imports the
 * Stripe SDK directly or knows about `Stripe.Account`'s shape — every
 * method maps Stripe's own vocabulary onto this port's provider-agnostic
 * DTOs before returning, so no Stripe SDK type ever crosses into
 * application/domain code (see `StripeConnectGateway`'s own doc
 * comment). Performs no business logic: never decides commission,
 * payout eligibility beyond reporting Stripe's own flags verbatim, or
 * whether an account *should* be created — those decisions belong to the
 * use cases that call this adapter.
 *
 * Uses Stripe Express connected accounts (`type: "express"`) — see
 * docs/MODULE_71_STRIPE_CONNECT.md for why Express (not Standard or
 * Custom) fits MaestroYa's marketplace model.
 */
export class StripeConnectGatewayAdapter implements StripeConnectGateway {
  constructor(private readonly stripe: Stripe) {}

  async createConnectedAccount(request: CreateConnectedAccountRequest): Promise<CreateConnectedAccountResult> {
    try {
      const account = await this.stripe.accounts.create(
        {
          type: "express",
          country: request.country,
          email: request.email ?? undefined,
          // Module 71 correction (post-audit): only `transfers` is
          // requested. Under separate charges and transfers, every
          // customer charge is created on the *platform's* Stripe
          // account — a professional's connected account never itself
          // processes a card/ACH charge, so it never needs
          // `card_payments`. Per Stripe's own capability docs
          // (https://docs.stripe.com/connect/account-capabilities):
          // "You can transfer funds to connected accounts that have the
          // transfers capability... Payments using the transfers
          // capability include Destination charges and Separate charges
          // and transfers" — `transfers` is the capability this
          // integration actually uses; `card_payments` is for accounts
          // that themselves process a charge (direct charges/
          // `on_behalf_of`), which MaestroYa's model never does.
          // Requesting `card_payments` anyway would require Stripe to
          // collect additional business/charge-processing verification
          // from the professional for a capability they'd never use.
          capabilities: {
            transfers: { requested: true },
          },
          business_type: "individual",
        },
        // Idempotency key deterministic per professional — a retried call
        // after a crash-before-persist (see this port's own doc comment)
        // returns the original account instead of creating a second one.
        { idempotencyKey: `connect-account:${request.professionalProfileId}` },
      );
      return { stripeAccountId: account.id };
    } catch (error) {
      throw mapStripeError(error);
    }
  }

  async createOnboardingLink(
    stripeAccountId: string,
    options: CreateOnboardingLinkOptions,
  ): Promise<CreateOnboardingLinkResult> {
    try {
      const link = await this.stripe.accountLinks.create({
        account: stripeAccountId,
        refresh_url: options.refreshUrl,
        return_url: options.returnUrl,
        type: "account_onboarding",
      });
      return { url: link.url, expiresAt: new Date(link.expires_at * 1000) };
    } catch (error) {
      throw mapStripeError(error);
    }
  }

  async retrieveAccountStatus(stripeAccountId: string): Promise<StripeAccountStatusResult> {
    try {
      const account = await this.stripe.accounts.retrieve(stripeAccountId);
      return {
        stripeAccountId: account.id,
        detailsSubmitted: Boolean(account.details_submitted),
        // Module 71 correction (post-audit): `account.charges_enabled` is
        // NOT read here. Per Stripe's own field definition
        // ("Whether the account can process charges" —
        // https://docs.stripe.com/api/accounts/object) and the
        // capabilities doc's description of `card_payments` as the
        // capability that lets an account "directly process card and ACH
        // payments," `charges_enabled` reflects charge-processing
        // capability this account never requests (see
        // `createConnectedAccount`'s own comment) — it would read `false`
        // forever regardless of how fully onboarded the account is,
        // making it useless as a readiness signal for this Connect model.
        // `capabilities.transfers === "active"` is the capability this
        // integration actually depends on: whether the platform can
        // successfully create a `Transfer` to this account. See
        // `domain/services/stripe-connect-account-rules.ts`'s own doc
        // comment for the resulting two-signal readiness model
        // (transfer readiness + payout readiness).
        transfersActive: account.capabilities?.transfers === "active",
        payoutsEnabled: Boolean(account.payouts_enabled),
        requirementsCurrentlyDue: account.requirements?.currently_due ?? [],
        disabledReason: account.requirements?.disabled_reason ?? null,
      };
    } catch (error) {
      throw mapStripeError(error);
    }
  }

  async createLoginLink(stripeAccountId: string): Promise<CreateLoginLinkResult> {
    try {
      const link = await this.stripe.accounts.createLoginLink(stripeAccountId);
      return { url: link.url };
    } catch (error) {
      throw mapStripeError(error);
    }
  }
}

/**
 * Maps any error a Stripe SDK call can throw onto a `StripeConnectError`
 * category — the one place in this module that ever inspects a Stripe
 * SDK error type. Never logs or rethrows the raw error's message beyond
 * what `StripeConnectError` itself carries; callers that need the
 * original for observability can still read it off `.cause`.
 */
function mapStripeError(error: unknown): StripeConnectError {
  if (error instanceof Stripe.errors.StripeError) {
    const message = error.message || "Stripe Connect request failed.";
    const category = classifyStripeError(error);
    const retryable = category === "RATE_LIMITED" || category === "NETWORK" || category === "TEMPORARY";
    return new StripeConnectError(category, message, retryable, { cause: error });
  }
  return new StripeConnectError(
    "UNKNOWN",
    error instanceof Error ? error.message : "Unknown Stripe Connect error.",
    false,
    { cause: error },
  );
}

function classifyStripeError(error: Stripe.errors.StripeError): StripeConnectErrorCategory {
  if (error instanceof Stripe.errors.StripeAuthenticationError) return "AUTHENTICATION";
  if (error instanceof Stripe.errors.StripePermissionError) return "ACCOUNT_RESTRICTED";
  if (error instanceof Stripe.errors.StripeRateLimitError) return "RATE_LIMITED";
  if (error instanceof Stripe.errors.StripeConnectionError) return "NETWORK";
  if (error instanceof Stripe.errors.StripeAPIError) return "TEMPORARY";
  if (error instanceof Stripe.errors.StripeInvalidRequestError) {
    return error.code === "resource_missing" ? "NOT_FOUND" : "INVALID_REQUEST";
  }
  return "UNKNOWN";
}
