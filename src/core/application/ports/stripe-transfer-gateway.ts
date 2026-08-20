/**
 * Module 76 — Professional Payout Execution.
 *
 * The single abstraction application code is allowed to depend on for
 * actually moving money out of the platform's Stripe balance to a
 * professional/company's connected Stripe Express account — the exact seam
 * `StripePaymentGatewayAdapter`'s own doc comment already reserves for
 * this module: "actually paying a professional out of \[the platform's\]
 * balance is a `stripe.transfers.create()` call this class deliberately
 * never makes; that is Module 76's job." No Stripe SDK type
 * (`Stripe.Transfer`, ...) appears here or anywhere it's called from — the
 * same "provider MUST NOT appear anywhere in this module" rule
 * `StripeConnectGateway`/`PaymentGateway` already establish for Connect
 * account management and customer PaymentIntents respectively, applied
 * here to the third and final leg of this platform's Stripe integration.
 *
 * Deliberately narrow — one method, one job. Does NOT resolve a payout
 * destination (`ResolvePayoutDestinationUseCase`, Module 75), does NOT
 * decide whether a payout is currently allowed (`CheckPayoutEligibilityUseCase`
 * + the fresh-eligibility checks `ExecuteProfessionalPayoutUseCase` runs
 * itself), and does NOT compute the payout amount (the already-recorded
 * `Commission` row via `RecordCommissionForPaymentUseCase`) — this port
 * only ever executes an already-fully-decided transfer.
 *
 * `StripeTransferGatewayAdapter`
 * (`infrastructure/payments/stripe/stripe-transfer-gateway.ts`) is the one
 * real implementation, wired from `infrastructure/payments/stripe/
 * compose.ts`, backed by the same shared `stripe` SDK client singleton
 * every other Stripe adapter in this codebase uses. Every method throws
 * `StripeTransferError` (`domain/errors/domain-error.ts`) — never a raw
 * Stripe SDK error — on failure.
 */
export interface CreateTransferRequest {
  /** The Stripe Express connected account id (`acct_...`) — always
   *  resolved by the caller via `ResolvePayoutDestinationUseCase`
   *  (Module 75), NEVER accepted from client input. See this port's own
   *  doc comment on "destination tampering." */
  destinationStripeAccountId: string;
  /** Plain decimal amount in this codebase's money convention (see
   *  `domain/services/money.ts`) — converted to Stripe's integer minor
   *  currency units by the adapter, never by a caller. Always derived from
   *  the already-recorded `Commission` row, NEVER accepted from client
   *  input — see this port's own doc comment on "amount tampering." */
  amount: number;
  /** ISO 4217 currency code. This platform operates in EUR only today —
   *  see `toStripeMinorUnits`'s own "Unsupported currency" guard, reused
   *  unchanged by this adapter. */
  currency: string;
  /** Stripe's own `Idempotency-Key` request header — deterministically
   *  derived by the caller from the `Payout.id` being executed
   *  (`payout:<jobId>`, see `Payout.idempotencyKey`'s own doc comment) and
   *  reused, unchanged, across every retried execution attempt for the
   *  same Payout. This is the primary defense against the "Stripe accepts
   *  the transfer, the network response is lost, a retry follows" race —
   *  Stripe itself returns the original Transfer for a repeated request
   *  carrying the same key, rather than creating a second one. */
  idempotencyKey: string;
  /** Opaque correlation ids written onto the Stripe Transfer's own
   *  `metadata` — never anything beyond internal ids MaestroYa already
   *  generated (no PII). `payoutId` is what
   *  `ProcessStripeConnectWebhookUseCase`'s transfer-reconciliation path
   *  (Module 76's own webhook extension) reads back out of a
   *  `transfer.created` event to correlate it to the `Payout` row that
   *  requested it. */
  metadata: {
    payoutId: string;
    jobId: string;
  };
}

export interface CreateTransferResult {
  /** Stripe's own `Transfer.id` (`tr_...`) — persisted as
   *  `Payout.stripeTransferId` the moment this call returns successfully. */
  stripeTransferId: string;
}

/**
 * Module 77 — Refund & Dispute Financial Execution: reverses an already-
 * created Stripe Transfer (Stripe's own `POST /v1/transfers/:id/reversals`)
 * — the Connect-side counterpart to a customer refund when a professional
 * has already been paid for a Job whose Payment is now being refunded.
 * Only a *full* reversal is supported (`amount` is always the Payout's own
 * full `amount` — see `ReverseProfessionalPayoutUseCase`'s own doc comment
 * on why a partial reversal is out of scope for this module).
 */
export interface ReverseTransferRequest {
  /** The Stripe `Transfer.id` (`tr_...`) being reversed — always
   *  `Payout.stripeTransferId`, NEVER accepted from client input. */
  stripeTransferId: string;
  /** Always the Payout's own full `amount`, server-derived — NEVER
   *  accepted from client input. */
  amount: number;
  currency: string;
  /** Stripe's own `Idempotency-Key` request header — deterministically
   *  derived by the caller from the Payout being reversed
   *  (`payout-reversal:<payoutId>`) and reused unchanged across every
   *  retried reversal attempt — same convention as `CreateTransferRequest.
   *  idempotencyKey`. */
  idempotencyKey: string;
  metadata: {
    payoutId: string;
  };
}

export interface ReverseTransferResult {
  /** Stripe's own `TransferReversal.id` (`trr_...`) — persisted as
   *  `Payout.stripeReversalId` the moment this call returns successfully. */
  stripeReversalId: string;
}

export interface StripeTransferGateway {
  /**
   * Creates a Stripe Transfer moving `request.amount` from the platform's
   * Stripe balance to `request.destinationStripeAccountId`. Idempotent at
   * the Stripe API level via `request.idempotencyKey` — see that field's
   * own doc comment. Throws `StripeTransferError` for every failure mode
   * (insufficient balance, invalid/restricted destination, a transient
   * Stripe-side error, ...) — never resolves with a partial/ambiguous
   * result.
   */
  createTransfer(request: CreateTransferRequest): Promise<CreateTransferResult>;

  /**
   * Module 77 — Refund & Dispute Financial Execution: reverses a
   * previously created Transfer — see `ReverseTransferRequest`'s own doc
   * comment. Idempotent at the Stripe API level via
   * `request.idempotencyKey`, exactly like `createTransfer`. Throws
   * `StripeTransferError` for every failure mode.
   */
  reverseTransfer(request: ReverseTransferRequest): Promise<ReverseTransferResult>;
}
