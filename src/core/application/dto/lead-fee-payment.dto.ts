import type { LeadFeeProviderPaymentStatus } from "@/application/ports/lead-fee-payment-gateway";

/**
 * Module 140 — the minimum the frontend needs to continue a lead-fee payment.
 * Explicit whitelist: no customer / contact / address / coordinate / user data, no
 * professional id, no provider secret key, no internal record. The purchase stays
 * PENDING_PAYMENT: `paymentStatus` is the provider attempt's state, never a purchase state.
 */
export interface LeadFeePaymentInitiationDTO {
  purchaseId: string;
  purchaseStatus: "PENDING_PAYMENT";
  /** Provider client-side confirmation token (Stripe.js `client_secret`). */
  clientSecret: string | null;
  /** Exact decimal string of the persisted LeadPurchase.totalAmount (fee + IVA). */
  totalAmount: string;
  currency: string;
  paymentStatus: LeadFeeProviderPaymentStatus;
}
