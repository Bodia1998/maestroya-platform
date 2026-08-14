import { DomainEvent } from "@/domain/events/domain-event";

/**
 * Module 65 — Trust & Integrity System. Raised by `RecordUserBehaviorSignalUseCase`
 * whenever a user's Trust Score actually moves (never raised for a
 * zero-delta recalculation, e.g. a score already clamped at 100 receiving
 * another positive event) — mirrors the `ScoreEvent` (scoreType TRUST) row
 * this event announces was just written.
 */
export class TrustScoreChanged extends DomainEvent {
  static readonly eventName = "trust_integrity.trust_score.changed";

  constructor(
    readonly userId: string,
    readonly reason: string,
    readonly scoreBefore: number,
    readonly scoreAfter: number,
  ) {
    super();
  }
}
