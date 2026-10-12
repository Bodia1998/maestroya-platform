import type { StripePaymentWebhookEvent } from "@/application/ports/stripe-payment-webhook-verifier";
import type { ExternalWebhookEventRepository } from "@/domain/repositories/external-webhook-event-repository";
import {
  LeadFeeDisputeAssociationConflictError,
  type LeadFeeDisputeRepository,
} from "@/domain/repositories/lead-fee-dispute-repository";
import type { LeadPurchasePaymentCorrelationReader, LeadPurchaseRecord } from "@/domain/repositories/lead-purchase-repository";
import type { LeadRepository } from "@/domain/repositories/lead-repository";
import {
  LeadFeeDisputeRejectedError,
  isLeadFeeDisputeEventType,
  mapProviderDisputeStatus,
  validateLeadFeeDisputeAgainstPurchase,
  type LeadFeeDisputeEventRejection,
  type LeadFeeDisputePurchaseEffect,
  type LeadFeeProviderDisputeFacts,
} from "@/domain/services/lead-fee-dispute";
import { LEAD_FLOW_VERSION } from "@/domain/services/lead";
import { STRIPE_LEAD_FEE_PAYMENTS_WEBHOOK_PROVIDER } from "@/application/use-cases/lead-fee-payment/process-lead-fee-payment-webhook.use-case";
import { logger } from "@/infrastructure/observability/logger";

export type ProcessLeadFeeDisputeWebhookOutcome =
  | "recorded" // first time this dispute is seen
  | "status-updated" // the dispute moved forward
  | "replay" // nothing new: a duplicate, stale or out-of-order event (the purchase was still converged)
  | "duplicate" // the event id was already processed
  | "unmatched" // not a lead-fee payment
  | "rejected"
  | "ignored";

export interface ProcessLeadFeeDisputeWebhookResult {
  outcome: ProcessLeadFeeDisputeWebhookOutcome;
  /** Internal only (logs/tests). Never put in an HTTP response. */
  rejection?: LeadFeeDisputeEventRejection;
  /** Internal only: what the dispute did to the purchase's access. */
  purchaseEffect?: LeadFeeDisputePurchaseEffect;
}

/**
 * Module 155 — LEAD_V1 lead-fee DISPUTE (chargeback) handling, driven ONLY by a signature-verified provider event.
 *
 * Reached from `/api/webhooks/stripe-payments` for `charge.dispute.created | updated | closed` whose PaymentIntent is the persisted,
 * write-once `paymentReference` of a lead purchase (`ownsEvent`). Any other dispute event keeps flowing to the legacy dispute
 * handler untouched. Nothing from the payload is trusted beyond "which provider payment is this about": the purchase is found by
 * that reference (never by metadata), the amount / currency are validated against the immutable M135/M136 snapshot, and an existing
 * dispute id can never be re-associated with another purchase, payment or charge.
 *
 * Effect (decision D25, default "suspend"): open dispute -> CONFIRMED becomes DISPUTED and contact access stops on the very next
 * call (access is derived from the persisted status on every read); WON / WARNING_CLOSED -> DISPUTED returns to CONFIRMED (the
 * original confirmedAt is kept); LOST -> REVOKED (+ a revocation record). The decision depends only on the CURRENT states, so
 * duplicate, stale and out-of-order events converge to the same result. The transaction (dispute record, purchase change,
 * revocation record, audit) is atomic; a failure (including a failing audit insert) rolls everything back, the event claim becomes
 * re-claimable and the error propagates (5xx -> provider retry).
 *
 * Deliberately NOT done here: no refund, no credit note, no invoice and no revenue-ledger posting. The financial consequence of a
 * chargeback needs an accounting decision that has not been made (see docs/MODULE_155_CHARGEBACKS_ACCESS_REVOCATION.md).
 * Unrecognised provider statuses are rejected without any state change (fail closed); nothing about the provider's ordering is assumed.
 */
export class ProcessLeadFeeDisputeWebhookUseCase {
  constructor(
    private readonly purchases: LeadPurchasePaymentCorrelationReader,
    private readonly leads: LeadRepository,
    private readonly disputes: Pick<LeadFeeDisputeRepository, "applyEvent">,
    private readonly webhookEvents: ExternalWebhookEventRepository,
    private readonly now: () => Date = () => new Date(),
  ) {}

  /** True when a signature-verified dispute event is about a LEAD_V1 lead-fee payment (its PaymentIntent is a persisted purchase reference). */
  async ownsEvent(event: StripePaymentWebhookEvent): Promise<boolean> {
    if (!isLeadFeeDisputeEventType(event.type) || !event.dispute) return false;
    const reference = event.dispute.paymentIntentId;
    if (typeof reference !== "string" || reference === "") return false;
    return (await this.purchases.findByPaymentReference(reference)) !== null;
  }

  async execute(event: StripePaymentWebhookEvent): Promise<ProcessLeadFeeDisputeWebhookResult> {
    const claim = await this.webhookEvents.claim({
      provider: STRIPE_LEAD_FEE_PAYMENTS_WEBHOOK_PROVIDER,
      externalEventId: event.id,
      eventType: event.type,
    });
    if (!claim.claimed) return { outcome: "duplicate" };

    try {
      const result = await this.process(event);
      await this.webhookEvents.markProcessed(claim.record.id);
      return result;
    } catch (error) {
      await this.webhookEvents.markFailed(claim.record.id);
      throw error;
    }
  }

  private async process(event: StripePaymentWebhookEvent): Promise<ProcessLeadFeeDisputeWebhookResult> {
    if (!isLeadFeeDisputeEventType(event.type) || !event.dispute) return { outcome: "ignored" };
    const dispute = event.dispute;

    const reference = dispute.paymentIntentId;
    const purchase = typeof reference === "string" && reference !== "" ? await this.purchases.findByPaymentReference(reference) : null;
    if (!purchase) {
      logger.error("lead_fee_dispute_webhook.unmatched_payment", { eventId: event.id, eventType: event.type, disputeId: dispute.disputeId });
      return { outcome: "unmatched" };
    }

    const lead = await this.leads.findById(purchase.leadId);
    if (!lead || lead.flowVersion !== LEAD_FLOW_VERSION) return this.reject(event, purchase, "NOT_LEAD_V1");

    const status = mapProviderDisputeStatus(event.type, dispute.status);
    if (!status) return this.reject(event, purchase, "STATUS_UNRECOGNIZED");

    const facts: LeadFeeProviderDisputeFacts = {
      providerDisputeId: dispute.disputeId,
      paymentReference: reference,
      providerChargeId: dispute.chargeId,
      amountMinorUnits: typeof dispute.amountMinorUnits === "number" ? dispute.amountMinorUnits : null,
      currency: dispute.currency,
      reason: dispute.reason,
      evidenceDueBy: dispute.evidenceDueBy,
    };
    const rejection = validateLeadFeeDisputeAgainstPurchase(facts, {
      status: purchase.status,
      paymentReference: purchase.paymentReference,
      currency: purchase.currency,
      totalAmount: purchase.financialSnapshot.totalAmount,
    });
    if (rejection) return this.reject(event, purchase, rejection);

    let applied;
    try {
      applied = await this.disputes.applyEvent({
        leadPurchaseId: purchase.id,
        providerEventId: event.id,
        providerEventAt: event.createdAt,
        status,
        dispute: facts,
        now: this.now(),
      });
    } catch (error) {
      if (error instanceof LeadFeeDisputeRejectedError && isEventRejection(error.reason)) return this.reject(event, purchase, error.reason);
      if (error instanceof LeadFeeDisputeAssociationConflictError) return this.reject(event, purchase, "ASSOCIATION_CONFLICT");
      throw error;
    }

    logger.info("lead_fee_dispute_webhook.applied", {
      eventId: event.id,
      eventType: event.type,
      purchaseId: purchase.id,
      disputeRecordId: applied.dispute.id,
      disputeStatus: applied.dispute.status,
      purchaseStatusBefore: applied.purchaseStatusBefore,
      purchaseStatusAfter: applied.purchaseStatusAfter,
      effect: applied.effect,
    });
    return {
      outcome: applied.created ? "recorded" : applied.statusChanged ? "status-updated" : "replay",
      purchaseEffect: applied.effect,
    };
  }

  private reject(event: StripePaymentWebhookEvent, purchase: LeadPurchaseRecord, rejection: LeadFeeDisputeEventRejection): ProcessLeadFeeDisputeWebhookResult {
    logger.error("lead_fee_dispute_webhook.rejected", {
      eventId: event.id,
      eventType: event.type,
      rejection,
      purchaseId: purchase.id,
      purchaseStatus: purchase.status,
      disputeId: event.dispute?.disputeId ?? null,
    });
    return { outcome: "rejected", rejection };
  }
}

const EVENT_REJECTIONS: readonly string[] = [
  "UNSUPPORTED_EVENT",
  "PAYMENT_REFERENCE_MISSING",
  "NOT_LEAD_V1",
  "SNAPSHOT_INVALID",
  "CURRENCY_MISMATCH",
  "AMOUNT_INVALID",
  "AMOUNT_EXCEEDS_PAYMENT",
  "CHARGE_MISSING",
  "STATUS_UNRECOGNIZED",
  "ASSOCIATION_CONFLICT",
];

function isEventRejection(reason: string): reason is LeadFeeDisputeEventRejection {
  return EVENT_REJECTIONS.includes(reason);
}
