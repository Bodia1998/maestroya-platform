import { ConflictError } from "@/domain/errors/domain-error";
import { Consent } from "@/domain/entities/consent";
import { ConsentGranted } from "@/domain/events/consent-granted";
import type { ConsentRepository } from "@/domain/repositories/consent-repository";
import type { ConsentTypeValue } from "@/domain/value-objects/consent-type";
import type { EventBus } from "@/application/ports/event-bus";
import { EventDispatchError } from "@/application/ports/event-dispatch-error";
import { type FailureReporter, NullFailureReporter } from "@/application/ports/failure-reporter";

export interface GrantConsentInput {
  type: ConsentTypeValue;
  version: string;
}

/**
 * Module 38 — GDPR Compliance: records a user granting one of the
 * platform's tracked consent types (`ConsentTypeValue`). Rejects granting
 * a type that already has an active (non-withdrawn) consent — call
 * `WithdrawConsentUseCase` first, mirroring `CreateDisputeUseCase`'s own
 * "one active X at a time" convention (see `dispute-rules.ts`'s doc
 * comment on the identical "same user, second concurrently-open" rule) —
 * a duplicate grant would otherwise leave two active rows for the same
 * (userId, type), which `ConsentRepository.findActiveByUserAndType`
 * assumes can never happen.
 */
export class GrantConsentUseCase {
  constructor(
    private readonly consents: ConsentRepository,
    private readonly eventBus: EventBus,
    private readonly failureReporter: FailureReporter = new NullFailureReporter(),
  ) {}

  async execute(userId: string, input: GrantConsentInput) {
    const existing = await this.consents.findActiveByUserAndType(userId, input.type);
    if (existing) {
      throw new ConflictError(`You have already granted ${input.type} consent (version ${existing.version}).`);
    }

    const consent = Consent.grant({ userId, type: input.type, version: input.version });

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
