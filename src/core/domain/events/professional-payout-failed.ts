import { DomainEvent } from "@/domain/events/domain-event";

/**
 * Module 76 — Professional Payout Execution.
 *
 * Raised by `ExecuteProfessionalPayoutUseCase` when a Stripe Transfer
 * attempt for an already-approved Job payout fails — either a Stripe API
 * failure (insufficient platform balance, a restricted/invalid destination
 * account, a transient Stripe-side error) or an eligibility/precondition
 * check re-run immediately before the transfer that no longer passes (a
 * payout hold was placed, KYC lapsed, a dispute opened) between approval
 * and execution. Never raised for the routine "this payout is already
 * PAID" idempotent short-circuit — only for an attempt that itself ends in
 * `FAILED`.
 *
 * `retryable` mirrors `StripeTransferError.retryable`/`PaymentGatewayError
 * .retryable` — `false` for a permanent business-rule or Stripe
 * invalid-request failure (retrying with the same inputs would fail
 * identically), `true` for a transient Stripe-side failure (rate limit,
 * network, temporary Stripe outage) safe to retry as-is. Consumed today
 * only for observability (logging/alerting); a future admin "retry failed
 * payouts" flow (Module 80's reconciliation surface) is the natural
 * subscriber, never built by this module.
 */
export class ProfessionalPayoutFailed extends DomainEvent {
  static readonly eventName = "payout.professional-payout-failed";

  constructor(
    readonly payoutId: string,
    readonly jobId: string,
    readonly failureReason: string,
    readonly retryable: boolean,
  ) {
    super();
  }
}
