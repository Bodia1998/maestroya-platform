import { DomainEvent } from "@/domain/events/domain-event";

/**
 * Module 65 — Trust & Integrity System. Raised whenever any of the
 * `Detect*UseCase`s persists a new `FraudSignal` row.
 */
export class FraudDetected extends DomainEvent {
  static readonly eventName = "trust_integrity.fraud.detected";

  constructor(
    readonly userId: string,
    readonly fraudSignalId: string,
    readonly type: string,
    readonly relatedUserIds: readonly string[],
  ) {
    super();
  }
}
