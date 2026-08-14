import { DomainEvent } from "@/domain/events/domain-event";

/**
 * Module 65 — Trust & Integrity System. Raised by
 * `ApplyAutomatedActionUseCase` for every non-suspension
 * `TrustAutomatedAction` it applies (`WARNING`, `TEMPORARY_RESTRICTION`,
 * `BOOKING_RESTRICTION`, `MESSAGING_RESTRICTION`, `PAYOUT_HOLD`,
 * `MANUAL_REVIEW`) — see `AccountSuspended` for the two suspension-tier
 * actions, kept as a separate event since they warrant different
 * downstream handling (e.g. forcing a session sign-out).
 */
export class AccountRestricted extends DomainEvent {
  static readonly eventName = "trust_integrity.account.restricted";

  constructor(
    readonly userId: string,
    readonly actionId: string,
    readonly actionType: string,
    readonly expiresAt: Date | null,
  ) {
    super();
  }
}
