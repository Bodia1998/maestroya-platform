import { DomainEvent } from "@/domain/events/domain-event";
import type { ConsentTypeValue } from "@/domain/value-objects/consent-type";

/**
 * Module 38 — GDPR Compliance. Raised by `GrantConsentUseCase` once a new
 * `Consent` row (`domain/entities/consent.ts`) has been persisted.
 */
export class ConsentGranted extends DomainEvent {
  static readonly eventName = "gdpr.consent.granted";

  constructor(
    readonly consentId: string,
    readonly userId: string,
    readonly type: ConsentTypeValue,
    readonly version: string,
    readonly grantedAt: Date,
  ) {
    super();
  }
}
