import { hashIp, truncateUserAgent } from "@/domain/services/security-key";
import { Consent } from "@/domain/entities/consent";
import { ConsentGranted } from "@/domain/events/consent-granted";
import type { ConsentRecord, ConsentRepository } from "@/domain/repositories/consent-repository";
import type { EventBus } from "@/application/ports/event-bus";
import { EventDispatchError } from "@/application/ports/event-dispatch-error";
import { type FailureReporter, NullFailureReporter } from "@/application/ports/failure-reporter";

export interface AcceptOnboardingTermsInput {
  version: string;
  /** Raw client IP, hashed internally with `ipPepper` before anything is
   *  persisted — never stored, logged, or returned. Same "hash at the use
   *  case boundary" convention `TrackVisitUseCase` (Module 60) follows. */
  rawIp?: string | null;
  userAgent?: string | null;
}

/**
 * Module 62 — Professional Onboarding, Step 1 (Accept Terms & Conditions).
 *
 * Reuses the existing Module 38 GDPR `Consent` aggregate/repository rather
 * than introducing a parallel "terms acceptance" table — this *is* a
 * `TERMS_OF_SERVICE` consent grant, recorded through the exact same
 * `ConsentRepository` `GrantConsentUseCase` writes through
 * (`application/use-cases/gdpr/grant-consent.use-case.ts`), with two
 * additive fields (`ipHash`/`userAgent`) the module brief specifically
 * requires for this step.
 *
 * Deliberately does **not** delegate to `GrantConsentUseCase` itself:
 * that use case throws `ConflictError` on a second grant of the same type
 * (correct for its own "explicit re-grant" UI, wrong here — onboarding
 * must be safely retryable, e.g. a professional resubmitting the same
 * onboarding form after a network error). Idempotent: if an active
 * `TERMS_OF_SERVICE` consent already exists, it is returned as-is rather
 * than superseded — accepting a *new* terms version is a distinct action
 * from onboarding (out of this module's scope; see
 * docs/MODULE_62_PROFESSIONAL_ONBOARDING.md).
 */
export class AcceptOnboardingTermsUseCase {
  constructor(
    private readonly consents: ConsentRepository,
    private readonly eventBus: EventBus,
    private readonly ipPepper: string,
    private readonly failureReporter: FailureReporter = new NullFailureReporter(),
  ) {}

  async execute(userId: string, input: AcceptOnboardingTermsInput): Promise<ConsentRecord> {
    const existing = await this.consents.findActiveByUserAndType(userId, "TERMS_OF_SERVICE");
    if (existing) return existing;

    const ipHash = input.rawIp ? hashIp(input.rawIp, this.ipPepper) : null;
    const userAgent = truncateUserAgent(input.userAgent);

    const consent = Consent.grant({ userId, type: "TERMS_OF_SERVICE", version: input.version, ipHash, userAgent });

    const record = await this.consents.create({
      userId: consent.userId,
      type: consent.type,
      version: consent.version,
      grantedAt: consent.grantedAt,
      ipHash: consent.ipHash,
      userAgent: consent.userAgent,
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
