import type {
  PaymentAuthorizationRequest,
  PaymentAuthorizationResult,
  PaymentGateway,
} from "@/application/ports/payment-gateway";

/**
 * Module 35 — Payment Domain Model Preparation.
 *
 * Thrown by every `NullPaymentGateway` method. Distinguishing this from a
 * `DomainError` on purpose: it is not a business-rule violation (nothing
 * about *this payment* is invalid), it is a configuration/wiring problem —
 * "no real `PaymentGateway` has been implemented yet." Surfacing it loudly
 * is deliberate: a silent no-op success here would be far more dangerous
 * for a payments domain than a loud failure, since a caller that
 * mistakenly reached this stub would otherwise believe money actually
 * moved.
 */
export class PaymentGatewayNotConfiguredError extends Error {
  constructor(operation: string) {
    super(
      `PaymentGateway.${operation}() was called, but no real payment gateway is wired up yet. ` +
        `NullPaymentGateway exists only to satisfy dependency injection ahead of Module 59 ` +
        `(Stripe Connect) — no application code should be invoking it before then.`,
    );
    this.name = "PaymentGatewayNotConfiguredError";
  }
}

/**
 * Placeholder `PaymentGateway` implementation (Module 35). Lets every
 * application-layer piece that will eventually depend on `PaymentGateway`
 * be written, composed, and compiled today — see
 * `infrastructure/payments/compose.ts`, the one place this is
 * instantiated — without a real payment integration existing yet.
 *
 * Performs no real payment processing whatsoever: every method rejects.
 * When Module 59 lands, `StripeConnectPaymentGateway` implements this same
 * `PaymentGateway` interface and `compose.ts` swaps to it; this class is
 * then deleted, not extended.
 */
export class NullPaymentGateway implements PaymentGateway {
  async authorize(_request: PaymentAuthorizationRequest): Promise<PaymentAuthorizationResult> {
    throw new PaymentGatewayNotConfiguredError("authorize");
  }

  async capture(_externalReference: string): Promise<void> {
    throw new PaymentGatewayNotConfiguredError("capture");
  }

  async refund(_externalReference: string, _amount: number): Promise<void> {
    throw new PaymentGatewayNotConfiguredError("refund");
  }

  async cancel(_externalReference: string): Promise<void> {
    throw new PaymentGatewayNotConfiguredError("cancel");
  }
}
