/**
 * Module 35 — Payment Domain Model Preparation.
 *
 * The single abstraction application code is allowed to depend on for
 * talking to an external payment processor. No Stripe SDK type, no
 * `PaymentIntent`, no Checkout Session, no webhook payload appears here or
 * anywhere it's called from — see the module brief's explicit "Stripe
 * MUST NOT appear anywhere in this module" rule. Method names
 * (`authorize`/`capture`/`refund`/`cancel`) are the same processor-neutral
 * vocabulary already used by the `PaymentStatus` value object
 * (`domain/value-objects/payment-status.ts`) and by the existing Prisma
 * `PaymentStatus` enum — generic marketplace-payment terms, not Stripe
 * ones, so they map onto Stripe Connect (Module 59:
 * `authorize` -> create + confirm a `PaymentIntent` with
 * `capture_method: "manual"`, `capture` -> `PaymentIntent.capture`,
 * `refund` -> `Refund.create`, `cancel` -> `PaymentIntent.cancel`) just as
 * cleanly as they'd map onto any other processor, without this interface
 * ever needing to change.
 *
 * `NullPaymentGateway` (`infrastructure/payments/null-payment-gateway.ts`)
 * is today's only implementation, wired from
 * `infrastructure/payments/compose.ts`. `StripeConnectPaymentGateway`
 * (Module 59) will implement this exact interface — swapping it in is a
 * one-line change in that same `compose.ts`, per the module's "future
 * compatibility" requirement; no application code that depends on
 * `PaymentGateway` needs to change.
 */
export interface PaymentAuthorizationRequest {
  /** The domain `Payment.id` this authorization is for — lets the gateway
   *  attach its own external reference back to a specific aggregate. */
  paymentId: string;
  amount: number;
  currency: string;
  payerId: string;
  /** Free-form context a real gateway implementation may attach to the
   *  external charge (e.g. a service-request id for reconciliation).
   *  Opaque to this port — never interpreted here. */
  metadata?: Record<string, string>;
  /**
   * Module 73 — Real Customer Payment Capture: an idempotency key the
   * caller derives deterministically from the thing being paid (e.g.
   * `payment-intent:quote:<quoteId>`), never from a per-attempt random
   * value. Passed straight through to the gateway's own idempotent-request
   * mechanism (Stripe's `Idempotency-Key` header for
   * `StripePaymentGatewayAdapter`) so that two concurrent or retried
   * `authorize()` calls for the *same* payable thing — a double-click, a
   * network retry, two concurrent requests racing each other — are
   * guaranteed by the gateway itself to resolve to the exact same external
   * charge, even before either caller's own database write happens. See
   * `InitiateQuotePaymentUseCase`'s own doc comment for the full
   * concurrency story (this is the first of two independent layers of
   * protection, the second being the database's own uniqueness constraint
   * on the persisted external reference). Optional — omitted entirely by
   * `NullPaymentGateway` callers/tests that don't care about idempotency.
   */
  idempotencyKey?: string;
}

export interface PaymentAuthorizationResult {
  /** The gateway's own identifier for the authorized charge (a Stripe
   *  `PaymentIntent.id`, once Module 59 exists) — opaque to the domain,
   *  kept only so a later `capture`/`refund`/`cancel` call can reference
   *  the same external charge. */
  externalReference: string;
  /**
   * Module 73 — Real Customer Payment Capture: the gateway's own
   * client-side confirmation secret (Stripe's PaymentIntent
   * `client_secret`), if the gateway's authorization flow requires a
   * separate client-side step to actually collect payment details and
   * confirm the charge (as every real card gateway does — this port's
   * `authorize()` only ever *creates* the charge attempt server-side; it
   * can never itself collect card details). `null` for gateways that need
   * no such step (e.g. a fully server-side test double). Never logged —
   * see `StripePaymentGatewayAdapter`'s own doc comment.
   */
  clientSecret: string | null;
}

/**
 * Module 77 — Refund & Dispute Financial Execution: `refund`'s own result
 * shape — Stripe's own `Refund.id` (opaque, persisted as `Refund.
 * stripeRefundId`) and its own refund status, mapped onto this port's
 * processor-neutral vocabulary rather than leaking Stripe's own string
 * union past this adapter.
 */
export interface PaymentRefundResult {
  externalRefundReference: string;
  status: "SUCCEEDED" | "PENDING" | "FAILED";
}

export interface PaymentRefundOptions {
  /**
   * Module 77 — Refund & Dispute Financial Execution: an idempotency key
   * the caller derives deterministically from the refund decision being
   * executed (e.g. `refund:<financialAdjustmentId>`), never from a
   * per-attempt random value — the exact same convention
   * `PaymentAuthorizationRequest.idempotencyKey` already establishes for
   * `authorize()`. Passed straight through to the gateway's own
   * idempotent-request mechanism (Stripe's `Idempotency-Key` header for
   * `StripePaymentGatewayAdapter`) so two concurrent or retried `refund()`
   * calls for the *same* logical refund converge on the exact same
   * external refund, even before either caller's own database write
   * happens.
   */
  idempotencyKey?: string;
}

export interface PaymentGateway {
  /** Reserves funds with the processor without capturing them. */
  authorize(request: PaymentAuthorizationRequest): Promise<PaymentAuthorizationResult>;

  /** Captures previously authorized (or immediately captures) funds for
   *  the charge identified by `externalReference`. */
  capture(externalReference: string): Promise<void>;

  /** Refunds `amount` against the charge identified by
   *  `externalReference`. May be called more than once for the same
   *  charge (partial refunds) — see `Payment.refund()`'s own "never refund
   *  more than was paid" invariant, enforced by the caller before this is
   *  ever invoked, never by this port itself. Module 77 — Refund & Dispute
   *  Financial Execution is the one caller: see `PaymentRefundOptions`/
   *  `PaymentRefundResult`'s own doc comments. */
  refund(externalReference: string, amount: number, options?: PaymentRefundOptions): Promise<PaymentRefundResult>;

  /** Cancels/voids an authorized-but-not-yet-captured charge. */
  cancel(externalReference: string): Promise<void>;
}
