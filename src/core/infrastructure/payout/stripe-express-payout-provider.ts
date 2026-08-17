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
 * Express as their payout method, so Module 71 (Stripe Connect) can pick
 * up exactly where this leaves off: `externalReference` is always `null`
 * here (no account exists yet) and `status` is always `PENDING`
 * (readiness, not verification — see `ProfessionalPayoutAccountRecord
 * .stripeExpressStatus`'s own doc comment for the three-value readiness
 * vocabulary this prepares).
 *
 * Module 71's `CreateStripeConnectedAccountUseCase` writes the real
 * account id onto `ProfessionalPayoutAccount.stripeExpressAccountId`
 * (schema.prisma) once it exists — the older, unused
 * `ProfessionalProfile.stripeConnectAccountId` column is a separate,
 * legacy field this module and Module 71 both deliberately leave alone.
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
