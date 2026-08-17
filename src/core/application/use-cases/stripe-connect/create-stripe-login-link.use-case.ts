import { ValidationError } from "@/domain/errors/domain-error";
import type { ProfessionalRepository } from "@/domain/repositories/professional-repository";
import type { ProfessionalOnboardingRepository } from "@/domain/repositories/professional-onboarding-repository";
import type {
  CreateLoginLinkResult,
  StripeConnectGateway,
} from "@/application/ports/stripe-connect-gateway";

/**
 * Module 71 — Stripe Connect.
 *
 * Generates a single-use Stripe Express Dashboard login link — lets an
 * onboarded professional view their own Stripe-side payout history,
 * balance, and tax forms without MaestroYa building any of that UI
 * itself (the standard Express-account pattern). Only meaningful once
 * onboarding has actually progressed; Stripe itself rejects the request
 * for an account that hasn't submitted the required details, which
 * surfaces here as a `StripeConnectError` — this use case does not
 * duplicate that check.
 */
export class CreateStripeLoginLinkUseCase {
  constructor(
    private readonly professionals: ProfessionalRepository,
    private readonly onboardings: ProfessionalOnboardingRepository,
    private readonly gateway: StripeConnectGateway,
  ) {}

  async execute(userId: string): Promise<CreateLoginLinkResult> {
    const professional = await this.professionals.findByUserId(userId);
    if (!professional) {
      throw new ValidationError("You must have a professional profile to open the Stripe dashboard.");
    }

    const payoutAccount = await this.onboardings.findPayoutAccountByProfessionalProfileId(professional.id);
    if (!payoutAccount?.stripeExpressAccountId) {
      throw new ValidationError("Create a Stripe connected account before opening the Stripe dashboard.");
    }

    return this.gateway.createLoginLink(payoutAccount.stripeExpressAccountId);
  }
}
