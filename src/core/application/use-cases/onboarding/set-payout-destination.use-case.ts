import { ValidationError } from "@/domain/errors/domain-error";
import type { PayoutMethodValue } from "@/domain/services/professional-onboarding-rules";
import type { ProfessionalRepository } from "@/domain/repositories/professional-repository";
import type {
  ProfessionalOnboardingRepository,
  ProfessionalPayoutAccountRecord,
} from "@/domain/repositories/professional-onboarding-repository";
import type { PayoutProvider } from "@/application/ports/payout-provider";

export interface SetPayoutDestinationInput {
  method: PayoutMethodValue;
  accountHolderName: string;
  /** Required when `method === "IBAN"`; ignored otherwise. */
  iban?: string;
}

/**
 * Module 62 — Professional Onboarding, Step 5 (Bank Account) / Step 6
 * (Stripe Express Readiness).
 *
 * Orchestrates the `PayoutProvider` abstraction
 * (`application/ports/payout-provider.ts`) to validate and record the
 * professional's payout destination — never itself knows how an IBAN is
 * validated/masked or what "Stripe Express readiness" means; that's each
 * `PayoutProvider` implementation's job (`infrastructure/payout/`).
 * `getPayoutProvider(input.method)` (injected as `resolveProvider`) is the
 * one indirection that keeps this use case decoupled from which concrete
 * provider handles a given method — see the port's own doc comment.
 */
export class SetPayoutDestinationUseCase {
  constructor(
    private readonly onboardings: ProfessionalOnboardingRepository,
    private readonly professionals: ProfessionalRepository,
    private readonly resolveProvider: (method: PayoutMethodValue) => PayoutProvider,
  ) {}

  async execute(userId: string, input: SetPayoutDestinationInput): Promise<ProfessionalPayoutAccountRecord> {
    const professional = await this.professionals.findByUserId(userId);
    if (!professional) {
      throw new ValidationError("You must have a professional profile to add a payout destination.");
    }

    if (input.method === "IBAN" && !input.iban) {
      throw new ValidationError("An IBAN is required for the IBAN payout method.");
    }

    const provider = this.resolveProvider(input.method);
    const result = await provider.registerDestination({
      professionalProfileId: professional.id,
      accountHolderName: input.accountHolderName,
      iban: input.iban,
    });

    return this.onboardings.upsertPayoutAccount({
      professionalProfileId: professional.id,
      method: result.method,
      status: result.status,
      accountHolderName: input.accountHolderName,
      ibanLast4: result.method === "IBAN" ? result.maskedAccount.replace(/^\*+/, "") : null,
      ibanHash: result.accountHash,
      stripeExpressStatus: result.method === "STRIPE_EXPRESS" ? "PENDING" : "NOT_STARTED",
    });
  }
}
