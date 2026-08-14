import { DomainEvent } from "@/domain/events/domain-event";

/**
 * Module 65 — Trust & Integrity System. Raised by `ReviewAppealUseCase`
 * when an appeal is approved (before the account is restored — see
 * `AccountReinstated` for that follow-up moment).
 */
export class AppealApproved extends DomainEvent {
  static readonly eventName = "trust_integrity.appeal.approved";

  constructor(
    readonly appealId: string,
    readonly userId: string,
    readonly reviewedByUserId: string,
  ) {
    super();
  }
}
