import { NotFoundError } from "@/domain/errors/domain-error";
import { Consent } from "@/domain/entities/consent";
import { ConsentWithdrawn } from "@/domain/events/consent-withdrawn";
import type { ConsentRepository } from "@/domain/repositories/consent-repository";
import type { ConsentTypeValue } from "@/domain/value-objects/consent-type";
import type { EventBus } from "@/application/ports/event-bus";
import { EventDispatchError } from "@/application/ports/event-dispatch-error";
import { type FailureReporter, NullFailureReporter } from "@/application/ports/failure-reporter";

/**
 * Module 38 — GDPR Compliance: withdraws a user's currently-active consent
 * of the given type. Throws `NotFoundError` if there is no active consent
 * of that type to withdraw (mirrors `NotificationRepository`'s own
 * "operate only on what exists and belongs to the caller" convention,
 * translated at this layer rather than the repository silently no-op'ing —
 * unlike `ConsentRepository.withdraw`'s own idempotent-by-id behavior,
 * which only matters once the caller already knows the row's id).
 */
export class WithdrawConsentUseCase {
  constructor(
    private readonly consents: ConsentRepository,
    private readonly eventBus: EventBus,
    private readonly failureReporter: FailureReporter = new NullFailureReporter(),
  ) {}

  async execute(userId: string, type: ConsentTypeValue) {
    const existing = await this.consents.findActiveByUserAndType(userId, type);
    if (!existing) {
      throw new NotFoundError("Consent", type);
    }

    // Runs the withdrawal through the domain entity first — even though
    // only `withdrawnAt` is persisted below — so the same invariants
    // `Consent.withdraw()` enforces (e.g. "not already withdrawn") are
    // checked before ever touching the repository, not duplicated here.
    const domainConsent = Consent.reconstitute(
      {
        userId: existing.userId,
        type: existing.type,
        version: existing.version,
        grantedAt: existing.grantedAt,
        withdrawnAt: existing.withdrawnAt,
        // Module 62 — Professional Onboarding: additive provenance fields
        // on ConsentProps — carried through as-is, never re-derived here.
        ipHash: existing.ipHash,
        userAgent: existing.userAgent,
      },
      existing.id,
    );
    const withdrawn = domainConsent.withdraw();

    const record = await this.consents.withdraw(existing.id, withdrawn.withdrawnAt!);

    try {
      await this.eventBus.publishAll([
        new ConsentWithdrawn(record.id, record.userId, record.type, record.withdrawnAt ?? withdrawn.withdrawnAt!),
      ]);
    } catch (error) {
      if (!(error instanceof EventDispatchError)) throw error;
      this.failureReporter.report(error, { event: error.eventName, eventId: error.eventId });
    }

    return record;
  }
}
