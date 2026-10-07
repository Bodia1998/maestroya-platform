import { InitiateLeadFeePaymentUseCase } from "@/application/use-cases/lead-fee-payment/initiate-lead-fee-payment.use-case";
import { PrismaLeadPurchaseRepository } from "@/infrastructure/database/prisma/repositories/prisma-lead-purchase-repository";
import { PrismaLeadRepository } from "@/infrastructure/database/prisma/repositories/prisma-lead-repository";
import { PrismaProfessionalRepository } from "@/infrastructure/database/prisma/repositories/prisma-professional-repository";
import { stripe } from "@/infrastructure/payments/stripe/client";
import { StripeLeadFeePaymentGatewayAdapter } from "@/infrastructure/payments/stripe/stripe-lead-fee-payment-gateway";

/**
 * Module 140 — LEAD_V1 lead-fee payment composition root (plain factory, same convention as
 * the other compose.ts files). Deliberately separate from `lead-purchase/compose.ts` (whose
 * trusted lifecycle factories must stay unreachable from the browser) and from the legacy
 * `payments/compose.ts`: it uses the dedicated lead-fee gateway (a Stripe PaymentIntent on the
 * platform account), NOT the legacy customer-job PaymentGateway. It only creates a payment
 * attempt for the persisted purchase total; Module 141 (verified webhook) is the only path
 * to CONFIRMED.
 */
export function makeInitiateLeadFeePaymentUseCase() {
  return new InitiateLeadFeePaymentUseCase(
    new PrismaProfessionalRepository(),
    new PrismaLeadPurchaseRepository(),
    new PrismaLeadRepository(),
    new StripeLeadFeePaymentGatewayAdapter(stripe),
  );
}
