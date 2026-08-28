import type { ProviderState } from "@/domain/services/reconciliation/provider-checks";

/**
 * Module 80 — Financial Reconciliation & Observability.
 *
 * The only abstraction the reconciliation engine depends on for asking
 * "what does Stripe itself say about this charge/transfer/refund" — no
 * Stripe SDK type crosses this boundary, mirroring `PaymentGateway`'s own
 * "Stripe MUST NOT appear anywhere in this module" rule
 * (`application/ports/payment-gateway.ts`). Read-only: no method here can
 * create, capture, retry, or reverse anything at the provider — this
 * module is an auditor, never an executor (see the spec's explicit "do
 * not execute or retry Stripe payouts / do not issue refunds
 * automatically" rules).
 *
 * `StripeProviderReconciliationAdapter`
 * (`infrastructure/payments/stripe/stripe-provider-reconciliation-adapter.ts`)
 * is the real implementation, using `stripe.paymentIntents.retrieve` /
 * `stripe.transfers.retrieve` / `stripe.refunds.retrieve`.
 * `NullProviderReconciliationAdapter` is the default composed binding
 * until an operator explicitly wires the real one — see that file's own
 * doc comment for the documented limitation this represents.
 */
export interface ProviderFinancialReconciliationPort {
  retrievePaymentState(stripePaymentIntentId: string): Promise<ProviderState | null>;
  retrieveTransferState(stripeTransferId: string): Promise<ProviderState | null>;
  retrieveRefundState(stripeRefundId: string): Promise<ProviderState | null>;
}
