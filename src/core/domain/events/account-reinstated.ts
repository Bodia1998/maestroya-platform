import { DomainEvent } from "@/domain/events/domain-event";

/**
 * Module 65 — Trust & Integrity System. Raised by `ReviewAppealUseCase`
 * once an approved appeal's account restriction has actually been lifted
 * (the `TrustAppeal` reaches `ACCOUNT_RESTORED`) — the reversal mirror of
 * `AccountSuspended`/`AccountRestricted`.
 */
export class AccountReinstated extends DomainEvent {
  static readonly eventName = "trust_integrity.account.reinstated";

  constructor(
    readonly userId: string,
    readonly actionId: string,
    readonly appealId: string,
  ) {
    super();
  }
}
