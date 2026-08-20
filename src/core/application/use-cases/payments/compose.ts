import "server-only";

import { env } from "@/infrastructure/config/env";
import { eventBus } from "@/infrastructure/events/compose";
import { getFeatureFlagService } from "@/infrastructure/feature-flags/compose";
import { createDistributedLock } from "@/infrastructure/locking/lock-service-factory";
import { PrismaCustomerProfileRepository } from "@/infrastructure/database/prisma/repositories/prisma-customer-profile-repository";
import { PrismaExternalWebhookEventRepository } from "@/infrastructure/database/prisma/repositories/prisma-external-webhook-event-repository";
import { PrismaJobRepository } from "@/infrastructure/database/prisma/repositories/prisma-job-repository";
import { PrismaPaymentRepository } from "@/infrastructure/database/prisma/repositories/prisma-payment-repository";
import { PrismaQuoteRepository } from "@/infrastructure/database/prisma/repositories/prisma-quote-repository";
import { paymentGateway } from "@/infrastructure/payments/compose";
import { stripe } from "@/infrastructure/payments/stripe/client";
import { StripePaymentWebhookVerifierAdapter } from "@/infrastructure/payments/stripe/stripe-payment-webhook-verifier";
import type { StripePaymentWebhookVerifier } from "@/application/ports/stripe-payment-webhook-verifier";
import { makeRecordCommissionForPaymentUseCase } from "@/application/use-cases/financial/compose";
import { PaymentCaptured } from "@/domain/events/payment-captured";
import { InitiateQuotePaymentUseCase } from "./initiate-quote-payment.use-case";
import { ProcessCustomerPaymentWebhookUseCase } from "./process-customer-payment-webhook.use-case";
import { RecordCommissionOnPaymentCapturedSubscriber } from "./record-commission-on-payment-captured.subscriber";

/**
 * Module 73 — Real Customer Payment Capture: composition root, same
 * manual-composition convention as every other `compose.ts` in this
 * codebase.
 *
 * Also the module's `eventBus.subscribe(PaymentCaptured, ...)` registration
 * point — see `RecordCommissionOnPaymentCapturedSubscriber`'s own doc
 * comment for why it lives here rather than in `financial/compose.ts`.
 * This file is imported once, deterministically at boot, from
 * `instrumentation.ts`'s subscriber-registration list — see that file's
 * own doc comment.
 */
const customerProfiles = new PrismaCustomerProfileRepository();
const jobs = new PrismaJobRepository();
const quotes = new PrismaQuoteRepository();
const payments = new PrismaPaymentRepository();
const webhookEvents = new PrismaExternalWebhookEventRepository();
const lock = createDistributedLock();

const stripePaymentWebhookVerifier: StripePaymentWebhookVerifier = new StripePaymentWebhookVerifierAdapter(
  stripe,
  env.STRIPE_PAYMENTS_WEBHOOK_SECRET,
);

export function getStripePaymentWebhookVerifierInstance(): StripePaymentWebhookVerifier {
  return stripePaymentWebhookVerifier;
}

export function makeInitiateQuotePaymentUseCase(): InitiateQuotePaymentUseCase {
  return new InitiateQuotePaymentUseCase(
    customerProfiles,
    jobs,
    quotes,
    payments,
    paymentGateway,
    lock,
    getFeatureFlagService(),
  );
}

export function makeProcessCustomerPaymentWebhookUseCase(): ProcessCustomerPaymentWebhookUseCase {
  return new ProcessCustomerPaymentWebhookUseCase(payments, paymentGateway, webhookEvents, eventBus);
}

eventBus.subscribe(
  PaymentCaptured,
  new RecordCommissionOnPaymentCapturedSubscriber(makeRecordCommissionForPaymentUseCase()),
);
