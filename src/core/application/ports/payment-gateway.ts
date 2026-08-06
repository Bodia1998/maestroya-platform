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
}

export interface PaymentAuthorizationResult {
  /** The gateway's own identifier for the authorized charge (a Stripe
   *  `PaymentIntent.id`, once Module 59 exists) — opaque to the domain,
   *  kept only so a later `capture`/`refund`/`cancel` call can reference
   *  the same external charge. */
  externalReference: string;
}

export interface PaymentGateway {
  /** Reserves funds with the processor without capturing them. */
  authorize(request: PaymentAuthorizationRequest): Promise<PaymentAuthorizationResult>;

  /** Captures previously authorized (or immediately captures) funds for
   *  the charge identified by `externalReference`. */
  capture(externalReference: string): Promise<void>;

  /** Refunds `amount` against the charge identified by
   *  `externalReference`. May be called more than once for the same
   *  charge (partial refunds). */
  refund(externalReference: string, amount: number): Promise<void>;

  /** Cancels/voids an authorized-but-not-yet-captured charge. */
  cancel(externalReference: string): Promise<void>;
}
