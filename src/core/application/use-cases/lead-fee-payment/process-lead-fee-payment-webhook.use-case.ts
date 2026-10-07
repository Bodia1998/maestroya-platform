import type { LeadPurchaseDTO } from "@/application/dto/lead-purchase.dto";
import type { StripePaymentWebhookEvent } from "@/application/ports/stripe-payment-webhook-verifier";
import type { ExternalWebhookEventRepository } from "@/domain/repositories/external-webhook-event-repository";
import type {
  LeadPurchasePaymentCorrelationReader,
  LeadPurchaseRecord,
  LeadPurchaseRepository,
} from "@/domain/repositories/lead-purchase-repository";
import type { LeadRepository } from "@/domain/repositories/lead-repository";
import { LEAD_FLOW_VERSION } from "@/domain/services/lead";
import {
  LEAD_FEE_PAYMENT_FLOW_MARKER,
  validateLeadFeePaymentFacts,
  type LeadFeeConfirmationRejection,
} from "@/domain/services/lead-fee-payment-confirmation";
import { InvalidLeadPurchaseTransitionError, LeadNotPurchasableError, type LeadPurchaseStatus } from "@/domain/services/lead-purchase";
import { logger } from "@/infrastructure/observability/logger";

/** Idempotency-ledger provider key: distinct from the legacy "STRIPE_PAYMENTS" stream, so LEAD_V1 events never share a ledger row with legacy ones. */
export const STRIPE_LEAD_FEE_PAYMENTS_WEBHOOK_PROVIDER = "STRIPE_LEAD_FEE_PAYMENTS";

export type ProcessLeadFeePaymentWebhookOutcome =
  | "confirmed"
  | "already-confirmed"
  | "cancelled"
  | "payment-failed-observed"
  | "duplicate"
  | "unmatched"
  | "rejected"
  | "ignored";

export interface ProcessLeadFeePaymentWebhookResult {
  outcome: ProcessLeadFeePaymentWebhookOutcome;
  /** Internal only (logs/tests). Never put in an HTTP response. */
  rejection?: LeadFeeConfirmationRejection;
}

/** The trusted non-confirming lifecycle collaborator (Module 126/137's TransitionLeadPurchaseUseCase satisfies it). */
export interface LeadPurchaseLifecycleTransitioner {
  execute(purchaseId: string, target: LeadPurchaseStatus): Promise<LeadPurchaseDTO>;
}

/** The trusted confirmation collaborator (Module 126's ConfirmLeadPurchaseUseCase satisfies it). */
export interface LeadPurchaseConfirmer {
  execute(purchaseId: string): Promise<LeadPurchaseDTO>;
}

/**
 * True when a signature-verified event is a LEAD_V1 lead-fee payment event. The marker is M140's
 * server-written `metadata.flow` (a PaymentIntent can only be created with the platform secret key,
 * never by a browser). It only ROUTES; the purchase itself is always identified by the persisted
 * `paymentReference`, never by this marker or any metadata id.
 */
export function isLeadFeePaymentEvent(event: StripePaymentWebhookEvent): boolean {
  return event.paymentIntent?.flow === LEAD_FEE_PAYMENT_FLOW_MARKER;
}

/**
 * Module 141 — the AUTHORITATIVE confirmation of a LEAD_V1 lead-fee payment.
 *
 * Receives only an already signature-verified event (the route verifies the raw body first; no Stripe
 * SDK type reaches this layer). It is the only path to PENDING_PAYMENT -> CONFIRMED besides the
 * trusted internal ConfirmLeadPurchaseUseCase it delegates to.
 *
 * `payment_intent.succeeded`: correlate by the persisted, write-once `LeadPurchase.paymentReference`
 * (never by a client/metadata purchase id), cross-check the echoed metadata, require a LEAD_V1 lead and
 * a valid M135/M136 snapshot, and compare amount (exact integer minor units) and currency with the
 * immutable snapshot. Only then is the purchase confirmed — by the existing conditional
 * `PENDING_PAYMENT -> CONFIRMED` transition (status-conditional UPDATE), so concurrent deliveries
 * confirm exactly once. Nothing else is written: no paymentReference repair, no snapshot change, no
 * contact flag (M138 derives access from status), no payment/commission/payout/invoice/revenue record.
 *
 * Idempotency: (1) the event id is claimed in the external-webhook ledger; (2) an already-CONFIRMED
 * purchase with the SAME reference/amount/currency is "already-confirmed" (no write, no error).
 * A different PaymentIntent never matches (the reference is unique and write-once) so it can neither
 * confirm nor overwrite anything.
 *
 * `payment_intent.canceled`: a canceled PaymentIntent can never be paid, and the write-once reference
 * cannot be replaced, so the matching PENDING_PAYMENT purchase is moved to CANCELLED (M137 lifecycle),
 * which frees the professional to start a new purchase. Snapshot untouched.
 * `payment_intent.payment_failed`: NON-terminal at the provider (the same PaymentIntent can be retried
 * and still succeed), so the purchase is deliberately left unchanged (FAILED is terminal and would
 * strand a later successful payment). Observed and logged only.
 *
 * Failure semantics: every business rejection is acknowledged (no provider retry can fix it) and logged
 * with structured, secret-free fields for operators; the purchase is not mutated. Only an unexpected
 * infrastructure error is rethrown (-> 5xx -> provider retry; the ledger entry becomes re-claimable).
 * Refunds/credit notes for a payment that cannot be confirmed (e.g. paid after the purchase turned
 * terminal, or the lead closed) belong to later modules.
 */
export class ProcessLeadFeePaymentWebhookUseCase {
  constructor(
    private readonly purchases: LeadPurchaseRepository & LeadPurchasePaymentCorrelationReader,
    private readonly leads: LeadRepository,
    private readonly confirmer: LeadPurchaseConfirmer,
    private readonly transitioner: LeadPurchaseLifecycleTransitioner,
    private readonly webhookEvents: ExternalWebhookEventRepository,
  ) {}

  async execute(event: StripePaymentWebhookEvent): Promise<ProcessLeadFeePaymentWebhookResult> {
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

  private async process(event: StripePaymentWebhookEvent): Promise<ProcessLeadFeePaymentWebhookResult> {
    if (!isLeadFeePaymentEvent(event)) return { outcome: "ignored" };
    switch (event.type) {
      case "payment_intent.succeeded":
        return this.onSucceeded(event);
      case "payment_intent.payment_failed":
        return this.onFailed(event);
      case "payment_intent.canceled":
        return this.onCanceled(event);
      default:
        return { outcome: "ignored" };
    }
  }

  private async onSucceeded(event: StripePaymentWebhookEvent): Promise<ProcessLeadFeePaymentWebhookResult> {
    const payment = event.paymentIntent!;
    const purchase = await this.correlate(event);
    if (!purchase) return { outcome: "unmatched" };

    const lead = await this.leads.findById(purchase.leadId);
    if (!lead || lead.flowVersion !== LEAD_FLOW_VERSION) return this.reject(event, purchase, "NOT_LEAD_V1");

    const rejection = validateLeadFeePaymentFacts(purchase, {
      paymentReference: payment.paymentIntentId,
      amountMinorUnits: payment.amountMinorUnits,
      currency: payment.currency,
      metadataPurchaseId: payment.leadPurchaseId ?? null,
      metadataLeadId: payment.leadId ?? null,
    });
    if (rejection) return this.reject(event, purchase, rejection);

    if (purchase.status === "CONFIRMED") return { outcome: "already-confirmed" };
    if (purchase.status !== "PENDING_PAYMENT") return this.reject(event, purchase, "STATUS_NOT_CONFIRMABLE");

    try {
      // Existing lifecycle path: Lead still PUBLISHED + request eligible, then the status-conditional
      // PENDING_PAYMENT -> CONFIRMED transition (exactly one concurrent caller writes).
      await this.confirmer.execute(purchase.id);
    } catch (error) {
      if (error instanceof LeadNotPurchasableError) return this.reject(event, purchase, "LEAD_NOT_CONFIRMABLE");
      if (error instanceof InvalidLeadPurchaseTransitionError) return this.reject(event, purchase, "STATUS_NOT_CONFIRMABLE");
      throw error;
    }

    logger.info("lead_fee_payment_webhook.confirmed", { eventId: event.id, purchaseId: purchase.id });
    return { outcome: "confirmed" };
  }

  private async onFailed(event: StripePaymentWebhookEvent): Promise<ProcessLeadFeePaymentWebhookResult> {
    const purchase = await this.correlate(event);
    if (!purchase) return { outcome: "unmatched" };
    // Non-terminal at the provider: the purchase is intentionally left untouched (see class doc).
    logger.info("lead_fee_payment_webhook.payment_failed_observed", { eventId: event.id, purchaseId: purchase.id, status: purchase.status });
    return { outcome: "payment-failed-observed" };
  }

  private async onCanceled(event: StripePaymentWebhookEvent): Promise<ProcessLeadFeePaymentWebhookResult> {
    const purchase = await this.correlate(event);
    if (!purchase) return { outcome: "unmatched" };
    if (purchase.paymentReference !== event.paymentIntent!.paymentIntentId) return this.reject(event, purchase, "REFERENCE_MISMATCH");
    if (purchase.status !== "PENDING_PAYMENT") {
      // Never touches a CONFIRMED (or already terminal) purchase: a cancel of a paid intent is impossible/irrelevant.
      return { outcome: "ignored" };
    }
    try {
      // Existing M126/M137 lifecycle path (status-conditional, idempotent, validates the state machine).
      await this.transitioner.execute(purchase.id, "CANCELLED");
    } catch (error) {
      if (error instanceof InvalidLeadPurchaseTransitionError) return { outcome: "ignored" }; // a concurrent transition won
      throw error;
    }
    logger.info("lead_fee_payment_webhook.cancelled", { eventId: event.id, purchaseId: purchase.id });
    return { outcome: "cancelled" };
  }

  /** Persisted write-once reference -> the one purchase. Metadata ids are never used to find it. */
  private async correlate(event: StripePaymentWebhookEvent): Promise<LeadPurchaseRecord | null> {
    const reference = event.paymentIntent?.paymentIntentId;
    if (typeof reference !== "string" || reference === "") {
      logger.warn("lead_fee_payment_webhook.reference_missing", { eventId: event.id, eventType: event.type });
      return null;
    }
    const purchase = await this.purchases.findByPaymentReference(reference);
    if (!purchase) {
      // Orphan payment: no purchase is created or guessed. Operators reconcile from this log.
      logger.error("lead_fee_payment_webhook.unmatched_payment", {
        eventId: event.id,
        eventType: event.type,
        paymentReference: reference,
        metadataPurchaseId: event.paymentIntent?.leadPurchaseId ?? null,
      });
    }
    return purchase;
  }

  private reject(
    event: StripePaymentWebhookEvent,
    purchase: LeadPurchaseRecord,
    rejection: LeadFeeConfirmationRejection,
  ): ProcessLeadFeePaymentWebhookResult {
    logger.error("lead_fee_payment_webhook.rejected", {
      eventId: event.id,
      eventType: event.type,
      rejection,
      purchaseId: purchase.id,
      purchaseStatus: purchase.status,
      paymentReference: event.paymentIntent?.paymentIntentId ?? null,
    });
    return { outcome: "rejected", rejection };
  }
}
