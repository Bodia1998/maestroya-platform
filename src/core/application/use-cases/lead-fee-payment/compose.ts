import { ConfirmLeadPurchaseUseCase } from "@/application/use-cases/lead-purchase/confirm-lead-purchase.use-case";
import { InitiateLeadFeePaymentUseCase } from "@/application/use-cases/lead-fee-payment/initiate-lead-fee-payment.use-case";
import { TransitionLeadPurchaseUseCase } from "@/application/use-cases/lead-purchase/transition-lead-purchase.use-case";
import { ProcessLeadFeePaymentWebhookUseCase } from "@/application/use-cases/lead-fee-payment/process-lead-fee-payment-webhook.use-case";
import { PrismaExternalWebhookEventRepository } from "@/infrastructure/database/prisma/repositories/prisma-external-webhook-event-repository";
import { PrismaLeadPurchaseRepository } from "@/infrastructure/database/prisma/repositories/prisma-lead-purchase-repository";
import { PrismaLeadRepository } from "@/infrastructure/database/prisma/repositories/prisma-lead-repository";
import { PrismaProfessionalRepository } from "@/infrastructure/database/prisma/repositories/prisma-professional-repository";
import { PrismaServiceRequestRepository } from "@/infrastructure/database/prisma/repositories/prisma-service-request-repository";
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

/**
 * Module 141 — composition of the LEAD_V1 lead-fee payment CONFIRMATION (signature-verified webhook).
 * Reached only from `/api/webhooks/stripe-payments` for events carrying M140's LEAD_V1 marker; it
 * shares nothing with the legacy customer-payment webhook use case (no PaymentGateway, commission,
 * payout, invoice or affiliate collaborator). Confirmation delegates to the existing trusted
 * ConfirmLeadPurchaseUseCase / TransitionLeadPurchaseUseCase (M126/M137 lifecycle rules).
 */
export function makeProcessLeadFeePaymentWebhookUseCase() {
  const purchases = new PrismaLeadPurchaseRepository();
  const leads = new PrismaLeadRepository();
  return new ProcessLeadFeePaymentWebhookUseCase(
    purchases,
    leads,
    new ConfirmLeadPurchaseUseCase(purchases, leads, new PrismaServiceRequestRepository()),
    new TransitionLeadPurchaseUseCase(purchases),
    new PrismaExternalWebhookEventRepository(),
  );
}
