import { ValidationError } from "@/domain/errors/domain-error";
import type { ProfessionalRepository } from "@/domain/repositories/professional-repository";
import type { ProfessionalOnboardingRepository } from "@/domain/repositories/professional-onboarding-repository";
import type {
  CreateOnboardingLinkResult,
  StripeConnectGateway,
} from "@/application/ports/stripe-connect-gateway";

/**
 * Module 71 — Stripe Connect.
 *
 * Generates a fresh hosted Stripe onboarding URL for a professional's
 * already-created connected account (`CreateStripeConnectedAccountUseCase`
 * must run first). Not idempotent by design — see
 * `StripeConnectGateway.createOnboardingLink`'s own doc comment; a caller
 * (e.g. the professional dashboard's "Continue Stripe setup" button) is
 * expected to call this again each time the professional needs to
 * (re)enter the hosted flow.
 */
export class CreateStripeOnboardingLinkUseCase {
  constructor(
    private readonly professionals: ProfessionalRepository,
    private readonly onboardings: ProfessionalOnboardingRepository,
    private readonly gateway: StripeConnectGateway,
    /** Builds the refresh/return URLs from a professional profile id —
     *  injected rather than hardcoded so this use case never itself
     *  knows about `NEXT_PUBLIC_APP_URL` or the dashboard's route
     *  structure (see `infrastructure/payments/stripe/compose.ts`). */
    private readonly buildUrls: (professionalProfileId: string) => { refreshUrl: string; returnUrl: string },
  ) {}

  async execute(userId: string): Promise<CreateOnboardingLinkResult> {
    const professional = await this.professionals.findByUserId(userId);
    if (!professional) {
      throw new ValidationError("You must have a professional profile to connect a Stripe account.");
    }

    const payoutAccount = await this.onboardings.findPayoutAccountByProfessionalProfileId(professional.id);
    if (!payoutAccount?.stripeExpressAccountId) {
      throw new ValidationError("Create a Stripe connected account before requesting an onboarding link.");
    }

    const { refreshUrl, returnUrl } = this.buildUrls(professional.id);
    return this.gateway.createOnboardingLink(payoutAccount.stripeExpressAccountId, { refreshUrl, returnUrl });
  }
}
