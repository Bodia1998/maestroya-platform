import { DomainEvent } from "@/domain/events/domain-event";
import type { ConsentTypeValue } from "@/domain/value-objects/consent-type";

/**
 * Module 38 — GDPR Compliance. Raised by `WithdrawConsentUseCase` once the
 * active `Consent` row for a (user, type) pair has been marked withdrawn.
 */
export class ConsentWithdrawn extends DomainEvent {
  static readonly eventName = "gdpr.consent.withdrawn";

  constructor(
    readonly consentId: string,
    readonly userId: string,
    readonly type: ConsentTypeValue,
    readonly withdrawnAt: Date,
  ) {
    super();
  }
}
