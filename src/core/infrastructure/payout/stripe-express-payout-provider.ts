import type {
  PayoutProvider,
  RegisterPayoutDestinationRequest,
  RegisterPayoutDestinationResult,
} from "@/application/ports/payout-provider";

/**
 * Module 62 — Professional Onboarding, Step 6 (Stripe Express Readiness).
 *
 * `PayoutProvider` implementation for the `STRIPE_EXPRESS` method.
 * Deliberately imports no Stripe SDK, calls no Stripe API, and never
 * creates a real Stripe Express account — per the module brief's explicit
 * "Do NOT integrate Stripe SDK. Only prepare onboarding state" rule. This
 * class's only job is to record that the professional has *chosen* Stripe
 * Express as their payout method, so a future Module 65 (Stripe Connect)
 * can pick up exactly where this leaves off: `externalReference` is always
 * `null` here (no account exists yet) and `status` is always `PENDING`
 * (readiness, not verification — see `ProfessionalPayoutAccountRecord
 * .stripeExpressStatus`'s own doc comment for the three-value readiness
 * vocabulary this prepares).
 *
 * `ProfessionalProfile.stripeConnectAccountId` (schema.prisma) already
 * exists as the eventual real Stripe Connect account id column — this
 * class deliberately never writes to it; that remains Module 65's job once
 * it exists.
 */
export class StripeExpressPayoutProvider implements PayoutProvider {
  readonly method = "STRIPE_EXPRESS" as const;

  registerDestination(request: RegisterPayoutDestinationRequest): Promise<RegisterPayoutDestinationResult> {
    void request;
    return Promise.resolve({
      method: "STRIPE_EXPRESS",
      status: "PENDING",
      maskedAccount: "Stripe Express — pending onboarding",
      accountHash: null,
      externalReference: null,
    });
  }
}
