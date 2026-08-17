import { ValidationError } from "@/domain/errors/domain-error";
import type { ProfessionalRepository } from "@/domain/repositories/professional-repository";
import type { UserRepository } from "@/domain/repositories/user-repository";
import type {
  ProfessionalOnboardingRepository,
  ProfessionalPayoutAccountRecord,
} from "@/domain/repositories/professional-onboarding-repository";
import type { StripeConnectGateway } from "@/application/ports/stripe-connect-gateway";

/**
 * Module 71 — Stripe Connect.
 *
 * Creates the professional's real Stripe Express connected account —
 * the operation Module 62's `StripeExpressPayoutProvider` deliberately
 * left unimplemented (see that class's own doc comment). Requires the
 * professional to have already selected `STRIPE_EXPRESS` as their payout
 * method via `SetPayoutDestinationUseCase`; this use case only ever
 * *advances* an existing payout-account row, it never creates one (see
 * `ProfessionalOnboardingRepository.updateStripeConnectAccount`'s own
 * doc comment).
 *
 * ## Idempotency
 * Application-level: if `ProfessionalPayoutAccount.stripeExpressAccountId`
 * is already set, this returns the existing record without calling
 * Stripe again — so a caller that retries after a network timeout (or a
 * process crash between the Stripe API call succeeding and the local
 * write committing) never creates two connected accounts for the same
 * professional. `StripeConnectGateway.createConnectedAccount` additionally
 * carries a deterministic Stripe-side idempotency key
 * (`connect-account:<professionalProfileId>` — see that port's own doc
 * comment) as defense in depth for the crash-before-persist case
 * specifically, where this application-level check itself never ran.
 */
export class CreateStripeConnectedAccountUseCase {
  constructor(
    private readonly professionals: ProfessionalRepository,
    private readonly onboardings: ProfessionalOnboardingRepository,
    private readonly users: UserRepository,
    private readonly gateway: StripeConnectGateway,
    /** ISO 3166-1 alpha-2 country every connected account is registered
     *  in — see `CreateConnectedAccountRequest.country`'s own doc
     *  comment for why this stays a constructor parameter rather than a
     *  hardcoded literal in this use case. */
    private readonly country: string = "ES",
  ) {}

  async execute(userId: string): Promise<ProfessionalPayoutAccountRecord> {
    const professional = await this.professionals.findByUserId(userId);
    if (!professional) {
      throw new ValidationError("You must have a professional profile to connect a Stripe account.");
    }

    const payoutAccount = await this.onboardings.findPayoutAccountByProfessionalProfileId(professional.id);
    if (!payoutAccount || payoutAccount.method !== "STRIPE_EXPRESS") {
      throw new ValidationError(
        "Select Stripe Express as your payout method before connecting a Stripe account.",
      );
    }

    if (payoutAccount.stripeExpressAccountId) {
      // Idempotent no-op — see this class's own doc comment.
      return payoutAccount;
    }

    const user = await this.users.findById(userId);

    const result = await this.gateway.createConnectedAccount({
      professionalProfileId: professional.id,
      email: user?.email ?? null,
      country: this.country,
    });

    return this.onboardings.updateStripeConnectAccount(professional.id, {
      stripeExpressAccountId: result.stripeAccountId,
      stripeExpressStatus: "PENDING",
    });
  }
}
