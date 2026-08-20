import { DomainEvent } from "@/domain/events/domain-event";

/**
 * Module 77 — Refund & Dispute Financial Execution.
 *
 * Raised by `ReverseProfessionalPayoutUseCase` the moment a previously
 * `PAID` Payout's Stripe Transfer has actually been reversed by Stripe and
 * the local `Payout` row has been durably marked `REVERSED` — never
 * before that write commits, mirroring `ProfessionalPayoutExecuted`'s own
 * doc comment exactly, applied to the opposite direction of money
 * movement. Only raised on the transition INTO `REVERSED`; a lost
 * compare-and-swap race (someone else's concurrent reversal already won)
 * never re-publishes this a second time.
 *
 * Consumer: `RecordRefundAuditLogSubscriber` (this module). Also the
 * smallest event a future Module 78 (IVA/tax credit notes) or Module 80
 * (Stripe <-> ledger reconciliation) needs to subscribe to independently
 * — this module does not itself implement either.
 */
export class ProfessionalPayoutReversed extends DomainEvent {
  static readonly eventName = "payout.professional-payout-reversed";

  constructor(
    readonly payoutId: string,
    readonly jobId: string | null,
    readonly paymentId: string | null,
    readonly professionalProfileId: string | null,
    readonly companyProfileId: string | null,
    readonly reversedAmount: number,
    readonly currency: string,
    readonly stripeReversalId: string,
  ) {
    super();
  }
}
