import { DomainEvent } from "@/domain/events/domain-event";

/**
 * Module 65 — Trust & Integrity System. Raised by `ReviewAppealUseCase`
 * when an appeal is rejected — the underlying `TrustAutomatedAction`
 * remains in effect.
 */
export class AppealRejected extends DomainEvent {
  static readonly eventName = "trust_integrity.appeal.rejected";

  constructor(
    readonly appealId: string,
    readonly userId: string,
    readonly reviewedByUserId: string,
    readonly reviewNotes: string,
  ) {
    super();
  }
}
