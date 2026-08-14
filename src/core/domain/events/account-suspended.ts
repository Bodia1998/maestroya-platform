import { DomainEvent } from "@/domain/events/domain-event";

/**
 * Module 65 — Trust & Integrity System. Raised by
 * `ApplyAutomatedActionUseCase` for `TEMPORARY_SUSPENSION`/
 * `PERMANENT_SUSPENSION` — the two actions that also flip `User.status`
 * to `SUSPENDED`/`BANNED` (see that use case's own doc comment).
 */
export class AccountSuspended extends DomainEvent {
  static readonly eventName = "trust_integrity.account.suspended";

  constructor(
    readonly userId: string,
    readonly actionId: string,
    readonly permanent: boolean,
    readonly expiresAt: Date | null,
  ) {
    super();
  }
}
