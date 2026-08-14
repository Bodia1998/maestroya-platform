import { DomainEvent } from "@/domain/events/domain-event";

/**
 * Module 65 — Trust & Integrity System. Raised by
 * `DetectOffPlatformCommunicationUseCase` for every
 * `OffPlatformDetectionEvent` it persists — a Notifications/Audit-Log
 * subscriber (Module 37's own convention) can react without depending on
 * this module's repositories directly.
 */
export class OffPlatformDetected extends DomainEvent {
  static readonly eventName = "trust_integrity.off_platform.detected";

  constructor(
    readonly userId: string,
    readonly channel: string,
    readonly confidence: number,
    readonly sourceType: string,
    readonly sourceId: string,
  ) {
    super();
  }
}
