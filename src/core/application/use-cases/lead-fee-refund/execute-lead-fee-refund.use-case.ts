import type { EventBus } from "@/application/ports/event-bus";
import type {
  LeadFeePaymentGateway,
  LeadFeeProviderRefund,
  LeadFeeProviderPaymentFacts,
} from "@/application/ports/lead-fee-payment-gateway";
import { PaymentGatewayError } from "@/domain/errors/domain-error";
import { LeadPurchaseRefunded } from "@/domain/events/lead-purchase-refunded";
import type { AdminRepository, AdminUserRecord } from "@/domain/repositories/admin-repository";
import {
  LeadFeeRefundAttemptConflictError,
  LeadFeeRefundTransitionConflictError,
  type LeadFeeRefundRecord,
  type LeadFeeRefundRepository,
} from "@/domain/repositories/lead-fee-refund-repository";
import type { LeadPurchasePaymentCorrelationReader, LeadPurchaseRecord, LeadPurchaseRepository } from "@/domain/repositories/lead-purchase-repository";
import { LeadFeePaymentNotInitiableError, leadFeePaymentTermsFromSnapshot, type LeadFeePaymentTerms } from "@/domain/services/lead-fee-payment";
import {
  LEAD_FEE_REFUND_ACTOR_ACTIVE_STATUS,
  LEAD_FEE_REFUND_ALLOWED_ACTOR_ROLES,
  LEAD_FEE_REFUND_UNRESOLVED_STATUSES,
  LeadFeeRefundRejectedError,
  assertLeadFeeRefundablePayment,
  canTransitionLeadFeeRefund,
  isDefinitiveLeadFeeRefundRejection,
  isLeadFeeRefundReasonCode,
  leadFeeRefundIdempotencyKey,
  normalizeLeadFeeRefundEvidenceReference,
  normalizeLeadFeeRefundExplanation,
  normalizeLeadFeeRefundProviderReference,
  type LeadFeeRefundConfig,
  type LeadFeeRefundReasonCode,
  type LeadFeeRefundStatus,
} from "@/domain/services/lead-fee-refund";
import type { LeadPurchaseStatus } from "@/domain/services/lead-purchase";
import { logger } from "@/infrastructure/observability/logger";

/** The trusted lifecycle collaborator (M126/M137's TransitionLeadPurchaseUseCase satisfies it). */
export interface LeadFeeRefundPurchaseTransitioner {
  execute(purchaseId: string, target: LeadPurchaseStatus): Promise<unknown>;
}

export interface ExecuteLeadFeeRefundInput {
  /** The administrator executing the refund. Re-validated here (role + ACTIVE status); a caller-supplied claim is never trusted. */
  actorUserId: string;
  leadPurchaseId: string;
  reasonCode: LeadFeeRefundReasonCode;
  explanation: string;
  /** Incident / evidence reference, separate from the explanation. */
  evidenceReference: string;
  /** DUPLICATE_CHARGE only: the provider id of the EXTRA payment to refund. */
  duplicatePaymentReference?: string;
}

export interface ExecuteLeadFeeRefundResult {
  refundId: string;
  reasonCode: LeadFeeRefundReasonCode;
  attemptNumber: number;
  /** SUCCEEDED only when the provider confirmed it. REQUESTED / UNKNOWN / PROVIDER_PENDING are unresolved: re-run later to reconcile. */
  status: LeadFeeRefundStatus;
  providerRefundId: string | null;
  refundedPaymentReference: string;
  /** The purchase status after this run (REFUNDED only after a confirmed PLATFORM_ERROR refund AND a successful transition). */
  purchaseStatus: LeadPurchaseStatus;
  /** True when this run created a new attempt (false when it only reconciled / completed an existing one). */
  newAttempt: boolean;
  /** True when the provider confirmed a PLATFORM_ERROR refund but the purchase transition failed: re-run to complete it. */
  purchaseTransitionPending: boolean;
}

const MUTABLE_STATUSES = LEAD_FEE_REFUND_UNRESOLVED_STATUSES;

/**
 * Module 153 — executes a FULL lead-fee refund for a CONFIRMED purchase (PLATFORM_ERROR) or refunds an EXTRA duplicate
 * payment of it (DUPLICATE_CHARGE). TRUSTED-INTERNAL, admin-initiated, and OFF unless the master switch is explicitly on.
 *
 * Safety properties (each pinned by tests): the amount is the persisted snapshot total and must equal the provider-confirmed
 * charge; partially refunded / refunded / disputed payments are never refunded; at most one active attempt per payment
 * (DB partial unique index); an UNKNOWN outcome is reconciled ONLY by listing the provider's refunds for our record id and is
 * NEVER replayed; a SUCCEEDED refund is never repeated; the purchase becomes REFUNDED only after the provider confirmed the
 * refund AND the local transition succeeded. No ledger / invoice / credit-note row is read or written.
 */
export class ExecuteLeadFeeRefundUseCase {
  constructor(
    private readonly purchases: Pick<LeadPurchaseRepository, "findById"> & LeadPurchasePaymentCorrelationReader,
    private readonly refunds: LeadFeeRefundRepository,
    private readonly gateway: LeadFeePaymentGateway,
    private readonly admins: Pick<AdminRepository, "getUserById">,
    private readonly transitioner: LeadFeeRefundPurchaseTransitioner,
    private readonly getConfig: () => LeadFeeRefundConfig,
    private readonly events?: Pick<EventBus, "publish">,
    private readonly now: () => Date = () => new Date(),
  ) {}

  async execute(input: ExecuteLeadFeeRefundInput): Promise<ExecuteLeadFeeRefundResult> {
    // 1. Pure input validation (no I/O).
    if (!isLeadFeeRefundReasonCode(input?.reasonCode)) throw new LeadFeeRefundRejectedError("INVALID_INPUT");
    const reasonCode = input.reasonCode;
    if (typeof input.actorUserId !== "string" || input.actorUserId.trim() === "") throw new LeadFeeRefundRejectedError("INVALID_INPUT");
    if (typeof input.leadPurchaseId !== "string" || input.leadPurchaseId.trim() === "") throw new LeadFeeRefundRejectedError("INVALID_INPUT");
    const explanation = normalizeLeadFeeRefundExplanation(input.explanation);
    const evidenceReference = normalizeLeadFeeRefundEvidenceReference(input.evidenceReference);
    let duplicateReference: string | null = null;
    if (reasonCode === "DUPLICATE_CHARGE") {
      if (input.duplicatePaymentReference === undefined) throw new LeadFeeRefundRejectedError("DUPLICATE_REFERENCE_REQUIRED");
      duplicateReference = normalizeLeadFeeRefundProviderReference(input.duplicatePaymentReference);
    } else if (input.duplicatePaymentReference !== undefined) {
      throw new LeadFeeRefundRejectedError("INVALID_INPUT");
    }

    // 2. Switch (fail closed), then the actor (re-read, never trusted from the caller).
    const config = this.getConfig();
    if (config.status !== "VALID") throw new LeadFeeRefundRejectedError("CONFIG_INVALID");
    if (!config.realRefundsEnabled) throw new LeadFeeRefundRejectedError("SWITCH_DISABLED");
    await this.assertAuthorizedActor(input.actorUserId.trim());

    // 3. Purchase and the payment this run targets.
    const purchase = await this.purchases.findById(input.leadPurchaseId.trim());
    if (!purchase) throw new LeadFeeRefundRejectedError("PURCHASE_NOT_FOUND");
    if (!purchase.paymentReference) throw new LeadFeeRefundRejectedError("PAYMENT_REFERENCE_MISSING");
    const terms = termsOf(purchase);
    let targetReference = purchase.paymentReference;
    if (reasonCode === "DUPLICATE_CHARGE") {
      targetReference = duplicateReference as string;
      if (targetReference === purchase.paymentReference) throw new LeadFeeRefundRejectedError("DUPLICATE_REFERENCE_SAME_AS_PURCHASE");
      // The extra payment must not be (or be claimed by) any purchase's own payment.
      if (await this.purchases.findByPaymentReference(targetReference)) throw new LeadFeeRefundRejectedError("DUPLICATE_REFERENCE_CONFLICT");
    }

    // 4. History of this payment decides what this run may do.
    const attempts = await this.refunds.listByPaymentReference(targetReference);
    for (const attempt of attempts) {
      if (attempt.leadPurchaseId !== purchase.id) throw new LeadFeeRefundRejectedError("DUPLICATE_REFERENCE_CONFLICT");
      if (attempt.reasonCode !== reasonCode) throw new LeadFeeRefundRejectedError("REASON_MISMATCH");
    }
    const succeeded = attempts.find((a) => a.status === "SUCCEEDED");
    if (succeeded) return this.completeSucceeded(purchase, succeeded, false);
    const unresolved = attempts.find((a) => (MUTABLE_STATUSES as readonly string[]).includes(a.status));
    if (unresolved) return this.reconcile(purchase, terms, unresolved);

    // 5. New attempt: every check re-runs (also after a definitive FAILED attempt).
    if (purchase.status !== "CONFIRMED") throw new LeadFeeRefundRejectedError("PURCHASE_NOT_CONFIRMED");
    await this.verifyProviderState(purchase, terms, reasonCode, targetReference);
    const attemptNumber = (attempts[attempts.length - 1]?.attemptNumber ?? 0) + 1;
    let record: LeadFeeRefundRecord;
    try {
      record = await this.refunds.createAttempt({
        leadPurchaseId: purchase.id,
        reasonCode,
        attemptNumber,
        amount: terms.totalAmount,
        currency: terms.currency,
        refundedPaymentReference: targetReference,
        purchasePaymentReference: purchase.paymentReference,
        idempotencyKey: leadFeeRefundIdempotencyKey(targetReference, attemptNumber),
        actorUserId: input.actorUserId.trim(),
        explanation,
        evidenceReference,
      });
    } catch (error) {
      if (error instanceof LeadFeeRefundAttemptConflictError) throw new LeadFeeRefundRejectedError("ATTEMPT_IN_PROGRESS");
      throw error;
    }
    return this.requestFromProvider(purchase, terms, record);
  }

  // ------------------------------------------------------------------ checks

  private async assertAuthorizedActor(actorUserId: string): Promise<void> {
    let actor: AdminUserRecord | null;
    try {
      actor = await this.admins.getUserById(actorUserId);
    } catch {
      throw new LeadFeeRefundRejectedError("ACTOR_NOT_AUTHORIZED");
    }
    const allowed = LEAD_FEE_REFUND_ALLOWED_ACTOR_ROLES as readonly string[];
    if (!actor || actor.status !== LEAD_FEE_REFUND_ACTOR_ACTIVE_STATUS || !Array.isArray(actor.roles) || !actor.roles.some((role) => allowed.includes(role))) {
      throw new LeadFeeRefundRejectedError("ACTOR_NOT_AUTHORIZED");
    }
  }

  /** Provider-confirmed state of the payment(s) involved, and the provider's full refund listing of the target payment. */
  private async verifyProviderState(purchase: LeadPurchaseRecord, terms: LeadFeePaymentTerms, reasonCode: LeadFeeRefundReasonCode, targetReference: string): Promise<void> {
    const expected = { purchaseId: purchase.id, totalMinorUnits: terms.totalMinorUnits, currency: terms.currency };
    // The purchase's own payment must be a succeeded, unrefunded, undisputed charge of exactly the snapshot total (both reasons).
    assertLeadFeeRefundablePayment(await this.readFacts(purchase.paymentReference as string), expected);
    if (reasonCode === "DUPLICATE_CHARGE") assertLeadFeeRefundablePayment(await this.readFacts(targetReference), expected);

    let listing: LeadFeeProviderRefund[];
    try {
      listing = await this.gateway.listRefunds(targetReference);
    } catch {
      throw new LeadFeeRefundRejectedError("PROVIDER_STATE_UNVERIFIABLE");
    }
    for (const refund of listing) {
      if (refund.status === "UNRECOGNIZED") throw new LeadFeeRefundRejectedError("PROVIDER_STATE_UNVERIFIABLE");
      if (refund.status === "SUCCEEDED" || refund.status === "PENDING") throw new LeadFeeRefundRejectedError("ALREADY_REFUNDED");
    }
  }

  private async readFacts(reference: string) {
    let facts: LeadFeeProviderPaymentFacts;
    try {
      facts = await this.gateway.retrievePaymentFacts(reference);
    } catch {
      throw new LeadFeeRefundRejectedError("PROVIDER_STATE_UNVERIFIABLE");
    }
    return {
      succeeded: facts.status === "SUCCEEDED",
      amountMinorUnits: facts.amountMinorUnits,
      amountReceivedMinorUnits: facts.amountReceivedMinorUnits,
      amountRefundedMinorUnits: facts.amountRefundedMinorUnits,
      refunded: facts.refunded,
      disputed: facts.disputed,
      currency: facts.currency,
      purchaseId: facts.purchaseId,
    };
  }

  // ------------------------------------------------------------------ provider interaction

  private async requestFromProvider(purchase: LeadPurchaseRecord, terms: LeadFeePaymentTerms, record: LeadFeeRefundRecord): Promise<ExecuteLeadFeeRefundResult> {
    let refund: LeadFeeProviderRefund;
    try {
      refund = await this.gateway.createRefund({
        refundRecordId: record.id,
        leadPurchaseId: purchase.id,
        paymentReference: record.refundedPaymentReference,
        amountMinorUnits: terms.totalMinorUnits,
        currency: terms.currency,
        idempotencyKey: record.idempotencyKey,
      });
    } catch (error) {
      // Only a definitive provider rejection is a failure. Timeouts / network / 5xx / anything else = outcome UNKNOWN (no replay).
      const definitive = error instanceof PaymentGatewayError && isDefinitiveLeadFeeRefundRejection(error.category);
      const settled = definitive
        ? await this.settle(record, { to: "FAILED", failureCategory: (error as PaymentGatewayError).category })
        : await this.settle(record, { to: "UNKNOWN" });
      if (!definitive) logger.error("Lead-fee refund outcome unknown; reconcile by re-running", { refundId: record.id });
      return this.result(purchase, settled, true, false);
    }
    return this.applyProviderRefund(purchase, terms, record, refund, true);
  }

  /** UNKNOWN / REQUESTED / PROVIDER_PENDING: ask the provider (listing only), NEVER send the refund again. */
  private async reconcile(purchase: LeadPurchaseRecord, terms: LeadFeePaymentTerms, record: LeadFeeRefundRecord): Promise<ExecuteLeadFeeRefundResult> {
    let listing: LeadFeeProviderRefund[];
    try {
      listing = await this.gateway.listRefunds(record.refundedPaymentReference);
    } catch {
      logger.warn("Lead-fee refund reconciliation could not read the provider listing", { refundId: record.id });
      return this.result(purchase, record, false, false);
    }
    const matches = listing.filter((r) => r.refundRecordId === record.id);
    if (matches.length === 0) {
      // Nothing at the provider carries our record id: the outcome stays unresolved (never "failed").
      const settled = record.status === "REQUESTED" ? await this.settle(record, { to: "UNKNOWN" }) : record;
      return this.result(purchase, settled, false, false);
    }
    if (matches.length > 1) {
      logger.error("Lead-fee refund reconciliation found several provider refunds for one record", { refundId: record.id });
      return this.result(purchase, record, false, false);
    }
    return this.applyProviderRefund(purchase, terms, record, matches[0] as LeadFeeProviderRefund, false);
  }

  private async applyProviderRefund(
    purchase: LeadPurchaseRecord,
    terms: LeadFeePaymentTerms,
    record: LeadFeeRefundRecord,
    refund: LeadFeeProviderRefund,
    newAttempt: boolean,
  ): Promise<ExecuteLeadFeeRefundResult> {
    const consistent =
      refund.paymentReference === record.refundedPaymentReference &&
      refund.amountMinorUnits === terms.totalMinorUnits &&
      refund.currency === record.currency &&
      (record.providerRefundId === null || record.providerRefundId === refund.reference);
    if (!consistent) {
      // A provider refund that does not match what we asked for is never trusted as success or failure.
      logger.error("Lead-fee refund provider answer does not match the attempt; left unresolved", { refundId: record.id });
      const settled = record.status === "REQUESTED" ? await this.settle(record, { to: "UNKNOWN" }) : record;
      return this.result(purchase, settled, newAttempt, false);
    }
    const providerRefundId = refund.reference;
    switch (refund.status) {
      case "SUCCEEDED": {
        const settled = await this.settle(record, { to: "SUCCEEDED", providerRefundId });
        return settled.status === "SUCCEEDED" ? this.completeSucceeded(purchase, settled, newAttempt) : this.result(purchase, settled, newAttempt, false);
      }
      case "PENDING":
        return this.result(purchase, await this.settle(record, { to: "PROVIDER_PENDING", providerRefundId }), newAttempt, false);
      case "FAILED":
        return this.result(purchase, await this.settle(record, { to: "FAILED", providerRefundId, failureCategory: "PROVIDER_FAILED" }), newAttempt, false);
      case "CANCELED":
        return this.result(purchase, await this.settle(record, { to: "FAILED", providerRefundId, failureCategory: "PROVIDER_CANCELED" }), newAttempt, false);
      default: {
        // Unrecognized provider status: unresolved / fail closed.
        const settled = record.status === "REQUESTED" ? await this.settle(record, { to: "UNKNOWN", providerRefundId }) : record;
        return this.result(purchase, settled, newAttempt, false);
      }
    }
  }

  /** Status-conditional write; a lost race returns the row as it is now instead of failing the (already provider-confirmed) outcome. */
  private async settle(
    record: LeadFeeRefundRecord,
    update: { to: LeadFeeRefundStatus; providerRefundId?: string; failureCategory?: string },
  ): Promise<LeadFeeRefundRecord> {
    const from = MUTABLE_STATUSES.filter((s) => s === update.to || canTransitionLeadFeeRefund(s, update.to));
    try {
      return await this.refunds.updateStatus(record.id, { from, ...update });
    } catch (error) {
      if (!(error instanceof LeadFeeRefundTransitionConflictError)) throw error;
      const current = (await this.refunds.listByPaymentReference(record.refundedPaymentReference)).find((a) => a.id === record.id);
      return current ?? record;
    }
  }

  // ------------------------------------------------------------------ purchase transition (PLATFORM_ERROR only)

  /** A provider-confirmed refund exists. PLATFORM_ERROR: move CONFIRMED -> REFUNDED (idempotent re-run). DUPLICATE_CHARGE: never touches the purchase. */
  private async completeSucceeded(purchase: LeadPurchaseRecord, record: LeadFeeRefundRecord, newAttempt: boolean): Promise<ExecuteLeadFeeRefundResult> {
    if (record.reasonCode !== "PLATFORM_ERROR") return this.result(purchase, record, newAttempt, false);

    let status = purchase.status;
    let transitionPending = false;
    if (status === "CONFIRMED") {
      try {
        await this.transitioner.execute(purchase.id, "REFUNDED");
        status = "REFUNDED";
      } catch (error) {
        // The refund itself stands (money has moved). The purchase stays CONFIRMED until a re-run completes the transition.
        transitionPending = true;
        logger.error("Lead-fee refund succeeded but the purchase transition failed; re-run to complete", {
          refundId: record.id,
          purchaseId: purchase.id,
          error: error instanceof Error ? error.message : "unknown",
        });
      }
    }
    if (status === "REFUNDED" && record.purchaseTransitionedAt === null) {
      let stamped = false;
      try {
        stamped = await this.refunds.markPurchaseTransitioned(record.id, this.now());
      } catch (error) {
        logger.warn("Lead-fee refund transition stamp failed", { refundId: record.id, error: error instanceof Error ? error.message : "unknown" });
      }
      if (stamped) await this.raiseRefunded(purchase.id);
    }
    return { ...this.result({ ...purchase, status }, record, newAttempt, transitionPending) };
  }

  /** Best effort, after the commit: a failure NEVER reverses the refund. There is no outbox / guaranteed delivery. */
  private async raiseRefunded(purchaseId: string): Promise<void> {
    if (!this.events) return;
    try {
      await this.events.publish(new LeadPurchaseRefunded(purchaseId));
    } catch (error) {
      logger.error("LeadPurchaseRefunded publish failed (refund unaffected)", { purchaseId, error: error instanceof Error ? error.message : "unknown" });
    }
  }

  private result(purchase: LeadPurchaseRecord, record: LeadFeeRefundRecord, newAttempt: boolean, purchaseTransitionPending: boolean): ExecuteLeadFeeRefundResult {
    return {
      refundId: record.id,
      reasonCode: record.reasonCode,
      attemptNumber: record.attemptNumber,
      status: record.status,
      providerRefundId: record.providerRefundId,
      refundedPaymentReference: record.refundedPaymentReference,
      purchaseStatus: purchase.status,
      newAttempt,
      purchaseTransitionPending,
    };
  }
}

function termsOf(purchase: LeadPurchaseRecord): LeadFeePaymentTerms {
  try {
    return leadFeePaymentTermsFromSnapshot(purchase);
  } catch (error) {
    if (error instanceof LeadFeePaymentNotInitiableError) throw new LeadFeeRefundRejectedError("SNAPSHOT_INVALID");
    throw error;
  }
}
