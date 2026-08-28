import { ValidationError } from "@/domain/errors/domain-error";
import type {
  SelfBillingAuthorizationRecord,
  SelfBillingAuthorizationRepository,
} from "@/domain/repositories/self-billing-authorization-repository";
import type { EventBus } from "@/application/ports/event-bus";
import { type FailureReporter, NullFailureReporter } from "@/application/ports/failure-reporter";
import { publishDomainEvent } from "@/application/services/events/publish-domain-event";
import { SelfBillingAuthorizationGranted } from "@/domain/events/self-billing-authorization-granted";

export interface GrantSelfBillingAuthorizationInput {
  professionalProfileId?: string | null;
  companyProfileId?: string | null;
  agreementVersion: string;
  acceptedByUserId: string;
  acceptanceIpAddress?: string | null;
  acceptanceUserAgent?: string | null;
}

/**
 * Module 79 — Invoicing & Credit Notes.
 *
 * The ONE place a professional/company electronically accepts MaestroYa's
 * self-billing (facturación por el destinatario) agreement — see the
 * module brief's "SELF-BILLING" section. This is deliberately NOT a fake
 * electronic-signature system: it records exactly the minimum the brief
 * asks for (authorization status, acceptance timestamp, who accepted it,
 * which agreement/version, and best-effort audit evidence), and nowhere
 * claims this constitutes a qualified electronic signature.
 *
 * Intended to be called from the existing professional-onboarding flow
 * (Module 62) as one additional step — this use case does not itself
 * gate/require onboarding completion; that policy decision belongs to
 * whichever onboarding orchestration calls it (out of this module's
 * scope to redesign Module 62).
 */
export class GrantSelfBillingAuthorizationUseCase {
  constructor(
    private readonly authorizations: SelfBillingAuthorizationRepository,
    private readonly eventBus: EventBus,
    private readonly failureReporter: FailureReporter = new NullFailureReporter(),
  ) {}

  async execute(input: GrantSelfBillingAuthorizationInput): Promise<SelfBillingAuthorizationRecord> {
    const professionalProfileId = input.professionalProfileId ?? null;
    const companyProfileId = input.companyProfileId ?? null;

    if (Boolean(professionalProfileId) === Boolean(companyProfileId)) {
      throw new ValidationError(
        "Exactly one of professionalProfileId/companyProfileId must be provided to grant a self-billing authorization.",
      );
    }
    if (!input.agreementVersion.trim()) {
      throw new ValidationError("agreementVersion is required to grant a self-billing authorization.");
    }
    if (!input.acceptedByUserId.trim()) {
      throw new ValidationError("acceptedByUserId is required to grant a self-billing authorization.");
    }

    const authorization = await this.authorizations.grant({
      professionalProfileId,
      companyProfileId,
      agreementVersion: input.agreementVersion,
      acceptedByUserId: input.acceptedByUserId,
      acceptedAt: new Date(),
      acceptanceIpAddress: input.acceptanceIpAddress ?? null,
      acceptanceUserAgent: input.acceptanceUserAgent ?? null,
    });

    await publishDomainEvent(
      this.eventBus,
      new SelfBillingAuthorizationGranted(
        authorization.id,
        authorization.professionalProfileId,
        authorization.companyProfileId,
        authorization.agreementVersion,
        authorization.acceptedByUserId,
      ),
      this.failureReporter,
    );

    return authorization;
  }
}
