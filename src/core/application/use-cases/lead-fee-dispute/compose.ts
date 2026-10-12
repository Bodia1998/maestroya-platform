import { ProcessLeadFeeDisputeWebhookUseCase } from "@/application/use-cases/lead-fee-dispute/process-lead-fee-dispute-webhook.use-case";
import { RevokeLeadPurchaseUseCase } from "@/application/use-cases/lead-fee-dispute/revoke-lead-purchase.use-case";
import { SubmitLeadFeeDisputeEvidenceUseCase } from "@/application/use-cases/lead-fee-dispute/submit-lead-fee-dispute-evidence.use-case";
import { resolveLeadFeeDisputeEvidenceConfig } from "@/domain/services/lead-fee-dispute";
import { PrismaAdminRepository } from "@/infrastructure/database/prisma/repositories/prisma-admin-repository";
import { PrismaExternalWebhookEventRepository } from "@/infrastructure/database/prisma/repositories/prisma-external-webhook-event-repository";
import {
  PrismaLeadFeeDisputeRepository,
  PrismaLeadPurchaseRevocationRepository,
} from "@/infrastructure/database/prisma/repositories/prisma-lead-fee-dispute-repository";
import { PrismaLeadPurchaseRepository } from "@/infrastructure/database/prisma/repositories/prisma-lead-purchase-repository";
import { PrismaLeadRepository } from "@/infrastructure/database/prisma/repositories/prisma-lead-repository";
import { stripe } from "@/infrastructure/payments/stripe/client";
import { StripeLeadFeeDisputeGatewayAdapter } from "@/infrastructure/payments/stripe/stripe-lead-fee-dispute-gateway";

/**
 * Module 155 — composition roots (plain factories, no DI container).
 *
 * `makeProcessLeadFeeDisputeWebhookUseCase` is reached ONLY from `/api/webhooks/stripe-payments`, after the signature was verified.
 * It shares nothing with the legacy dispute handler (no Payment, Job, Commission, Payout, FinancialAdjustment or Refund).
 *
 * `makeRevokeLeadPurchaseUseCase` and `makeSubmitLeadFeeDisputeEvidenceUseCase` are TRUSTED-INTERNAL, like Module 153/154: nothing
 * calls them today (no route, Server Action, job, subscriber or admin UI before M157) and they must never be reachable from the
 * browser. The evidence switch is read from the environment on EVERY call and fails CLOSED (OFF unless exactly "true").
 */
export function makeProcessLeadFeeDisputeWebhookUseCase() {
  return new ProcessLeadFeeDisputeWebhookUseCase(
    new PrismaLeadPurchaseRepository(),
    new PrismaLeadRepository(),
    new PrismaLeadFeeDisputeRepository(),
    new PrismaExternalWebhookEventRepository(),
  );
}

/** Module 155: the post-confirmation hook of the M141 webhook (a dispute that arrived BEFORE the payment was confirmed). */
export function makeLeadFeeDisputeReconciler() {
  const disputes = new PrismaLeadFeeDisputeRepository();
  return { reconcile: (leadPurchaseId: string) => disputes.reconcilePurchase(leadPurchaseId, new Date()) };
}

export function makeRevokeLeadPurchaseUseCase() {
  return new RevokeLeadPurchaseUseCase(new PrismaLeadPurchaseRepository(), new PrismaLeadPurchaseRevocationRepository(), new PrismaAdminRepository());
}

export function makeSubmitLeadFeeDisputeEvidenceUseCase() {
  return new SubmitLeadFeeDisputeEvidenceUseCase(
    new PrismaLeadFeeDisputeRepository(),
    new StripeLeadFeeDisputeGatewayAdapter(stripe),
    new PrismaAdminRepository(),
    () => resolveLeadFeeDisputeEvidenceConfig(process.env),
  );
}
