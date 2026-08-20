import { DomainEvent } from "@/domain/events/domain-event";

/**
 * Module 76 — Professional Payout Execution.
 *
 * Raised by `ExecuteProfessionalPayoutUseCase` the moment a Stripe
 * Transfer for a Job's approved payout has actually been accepted by
 * Stripe and the local `Payout` row has been durably marked `PAID` — never
 * before that write commits (see that use case's own doc comment on "a
 * payout must never be marked successful before the Stripe operation has
 * been successfully accepted"). Only raised on the transition INTO
 * `PAID` — re-running an already-`PAID` payout (the idempotent
 * short-circuit) never re-publishes this a second time, the same
 * "no duplicate financial-effect notification" guarantee
 * `PaymentReleaseApproved`/`PaymentCaptured` already give their own
 * subscribers.
 *
 * The smallest event downstream modules need: Module 78 (IVA/tax),
 * Module 79 (invoices/credit notes), and Module 80 (Stripe <-> ledger
 * reconciliation) can each subscribe independently without this module
 * knowing any of them exist — see `EventBus`'s own doc comment on why
 * subscriptions are never centrally enumerated.
 */
export class ProfessionalPayoutExecuted extends DomainEvent {
  static readonly eventName = "payout.professional-payout-executed";

  constructor(
    readonly payoutId: string,
    readonly jobId: string,
    readonly paymentId: string,
    readonly professionalProfileId: string | null,
    readonly companyProfileId: string | null,
    readonly amount: number,
    readonly currency: string,
    readonly stripeTransferId: string,
  ) {
    super();
  }
}
