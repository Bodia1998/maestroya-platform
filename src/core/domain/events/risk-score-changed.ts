import { DomainEvent } from "@/domain/events/domain-event";

/**
 * Module 65 — Trust & Integrity System. The Risk Score mirror of
 * `TrustScoreChanged` — see that event's own doc comment.
 */
export class RiskScoreChanged extends DomainEvent {
  static readonly eventName = "trust_integrity.risk_score.changed";

  constructor(
    readonly userId: string,
    readonly reason: string,
    readonly scoreBefore: number,
    readonly scoreAfter: number,
  ) {
    super();
  }
}
