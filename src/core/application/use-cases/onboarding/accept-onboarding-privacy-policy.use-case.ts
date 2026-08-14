import { Consent } from "@/domain/entities/consent";
import { ConsentGranted } from "@/domain/events/consent-granted";
import type { ConsentRecord, ConsentRepository } from "@/domain/repositories/consent-repository";
import type { EventBus } from "@/application/ports/event-bus";
import { EventDispatchError } from "@/application/ports/event-dispatch-error";
import { type FailureReporter, NullFailureReporter } from "@/application/ports/failure-reporter";

export interface AcceptOnboardingPrivacyPolicyInput {
  version: string;
}

/**
 * Module 62 — Professional Onboarding, Step 2 (Accept Privacy Policy).
 *
 * Same reuse of the Module 38 `Consent` aggregate as
 * `AcceptOnboardingTermsUseCase` (see that class's own doc comment for why
 * this doesn't delegate to `GrantConsentUseCase`), for `PRIVACY_POLICY`
 * instead of `TERMS_OF_SERVICE`. The module brief only requires
 * `acceptedAt`/`privacyPolicyVersion` for this step (no ipHash/userAgent),
 * so those two fields are left `null` here.
 */
export class AcceptOnboardingPrivacyPolicyUseCase {
  constructor(
    private readonly consents: ConsentRepository,
    private readonly eventBus: EventBus,
    private readonly failureReporter: FailureReporter = new NullFailureReporter(),
  ) {}

  async execute(userId: string, input: AcceptOnboardingPrivacyPolicyInput): Promise<ConsentRecord> {
    const existing = await this.consents.findActiveByUserAndType(userId, "PRIVACY_POLICY");
    if (existing) return existing;

    const consent = Consent.grant({ userId, type: "PRIVACY_POLICY", version: input.version });

    const record = await this.consents.create({
      userId: consent.userId,
      type: consent.type,
      version: consent.version,
      grantedAt: consent.grantedAt,
    });

    try {
      await this.eventBus.publishAll([
        new ConsentGranted(record.id, record.userId, record.type, record.version, record.grantedAt),
      ]);
    } catch (error) {
      if (!(error instanceof EventDispatchError)) throw error;
      this.failureReporter.report(error, { event: error.eventName, eventId: error.eventId });
    }

    return record;
  }
}
