import { ValidationError } from "@/domain/errors/domain-error";
import { deriveStripeExpressReadiness } from "@/domain/services/stripe-connect-account-rules";
import type { ProfessionalRepository } from "@/domain/repositories/professional-repository";
import type {
  ProfessionalOnboardingRepository,
  ProfessionalPayoutAccountRecord,
} from "@/domain/repositories/professional-onboarding-repository";
import type { StripeConnectGateway } from "@/application/ports/stripe-connect-gateway";

/**
 * Module 71 — Stripe Connect.
 *
 * Reads a professional's Stripe Connect account state directly from
 * Stripe and mirrors it onto `ProfessionalPayoutAccount` — the
 * synchronization point the professional dashboard polls after they
 * return from Stripe's hosted onboarding flow, and the same shape a
 * future Module 72 webhook handler would reconcile against for
 * `account.updated` events (that module can reuse
 * `deriveStripeExpressReadiness`/`isStripePayoutEligible`
 * (`domain/services/stripe-connect-account-rules.ts`) and
 * `ProfessionalOnboardingRepository.updateStripeConnectAccount` exactly
 * as this use case does, without either needing to change).
 *
 * Safe to call repeatedly — every call re-reads Stripe and overwrites the
 * mirrored fields with Stripe's current answer; there is no local state
 * this method could corrupt by running twice.
 */
export class GetStripeAccountStatusUseCase {
  constructor(
    private readonly professionals: ProfessionalRepository,
    private readonly onboardings: ProfessionalOnboardingRepository,
    private readonly gateway: StripeConnectGateway,
  ) {}

  async execute(userId: string): Promise<ProfessionalPayoutAccountRecord> {
    const professional = await this.professionals.findByUserId(userId);
    if (!professional) {
      throw new ValidationError("You must have a professional profile to check Stripe account status.");
    }

    const payoutAccount = await this.onboardings.findPayoutAccountByProfessionalProfileId(professional.id);
    if (!payoutAccount?.stripeExpressAccountId) {
      // No connected account exists yet — nothing to synchronize.
      // Reporting the locally-known state (NOT_STARTED/PENDING, per
      // `SetPayoutDestinationUseCase`) rather than throwing lets a
      // caller poll this use case unconditionally without first
      // checking whether an account exists.
      if (!payoutAccount) {
        throw new ValidationError("Select Stripe Express as your payout method first.");
      }
      return payoutAccount;
    }

    const status = await this.gateway.retrieveAccountStatus(payoutAccount.stripeExpressAccountId);
    const requirementsCurrentlyDue = status.requirementsCurrentlyDue.length > 0;
    const readiness = deriveStripeExpressReadiness({
      detailsSubmitted: status.detailsSubmitted,
      transfersActive: status.transfersActive,
      payoutsEnabled: status.payoutsEnabled,
      requirementsCurrentlyDue,
    });

    return this.onboardings.updateStripeConnectAccount(professional.id, {
      stripeExpressStatus: readiness,
      // Post-audit correction: `stripeChargesEnabled` mirrors Stripe's
      // `transfers` capability-active status here, not the literal
      // Stripe `charges_enabled` field — see
      // `ProfessionalPayoutAccountRecord.stripeChargesEnabled`'s own doc
      // comment for why this column is repurposed rather than migrated.
      stripeChargesEnabled: status.transfersActive,
      stripePayoutsEnabled: status.payoutsEnabled,
      stripeDetailsSubmitted: status.detailsSubmitted,
      stripeRequirementsCurrentlyDue: requirementsCurrentlyDue,
      stripeConnectSyncedAt: new Date(),
    });
  }
}
