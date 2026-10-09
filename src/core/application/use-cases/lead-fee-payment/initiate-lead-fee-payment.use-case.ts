import type { LeadFeePaymentInitiationDTO } from "@/application/dto/lead-fee-payment.dto";
import type { LeadPurchaseEligibilityEvaluator } from "@/application/services/lead-purchase-eligibility-policy";
import type { LeadFeePaymentGateway, LeadFeeProviderPayment } from "@/application/ports/lead-fee-payment-gateway";
import { PaymentGatewayError } from "@/domain/errors/domain-error";
import type { LeadPurchaseRepository } from "@/domain/repositories/lead-purchase-repository";
import type { LeadRepository } from "@/domain/repositories/lead-repository";
import type { ProfessionalRepository } from "@/domain/repositories/professional-repository";
import {
  LeadFeePaymentNotInitiableError,
  LeadFeePaymentUnavailableError,
  leadFeePaymentIdempotencyKey,
  leadFeePaymentTermsFromPurchase,
  type LeadFeePaymentTerms,
} from "@/domain/services/lead-fee-payment";
import { LEAD_FLOW_VERSION } from "@/domain/services/lead";
import { decideProfessionalVerificationEligibility } from "@/domain/services/lead-purchase-eligibility";
import { logger } from "@/infrastructure/observability/logger";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Module 140 — a professional starts paying the LEAD_V1 lead fee of their own purchase.
 *
 * Result: a provider payment ATTEMPT for the persisted `LeadPurchase.totalAmount`. This use
 * case NEVER confirms the purchase (it stays PENDING_PAYMENT), unlocks contact, issues an
 * invoice, refunds, pays out or records revenue: Module 141 alone moves PENDING_PAYMENT ->
 * CONFIRMED, from a signature-verified provider webhook — never from this call's result.
 *
 * Trust boundary: `userId` is the server-session user; the professional is resolved from it.
 * The only client value is `purchaseId`, and it is NOT authorization by itself: the purchase
 * must belong to that professional. There is no amount / currency / professional input.
 *
 * Amount authority: the provider receives exactly the persisted snapshot total (fee + IVA,
 * M135/M136), converted to minor units with bigint fixed-point arithmetic in the domain. No
 * pricing engine, tax engine, rate or configuration is read here. Nothing is repaired:
 * a missing/malformed/inconsistent snapshot is rejected.
 *
 * Idempotency (per purchase, two layers): (1) a deterministic provider idempotency key
 * derived from the purchase id, so retried/concurrent creates converge on ONE provider
 * payment; (2) the provider reference is persisted write-once on the purchase
 * (`recordPaymentReference`, unique), so every later call REUSES that attempt (same
 * client secret) instead of creating another — also after the provider's key window.
 * If a create loses a race / the purchase turned terminal meanwhile, the surplus attempt
 * is cancelled best-effort and never returned. No lock is held around the provider call.
 *
 * Failure: any provider failure is a safe LeadFeePaymentUnavailableError (no provider
 * detail, secret or customer data); the purchase and its snapshot are never mutated.
 *
 * Eligibility (Module 147, defensive): the shared policy (M98 ACTIVE + VERIFIED, M146 billing-ready)
 * is evaluated on the session professional. Its M98 half runs first, before the purchase is read, on
 * every call, exactly as before. The billing half is re-checked only where a NEW provider payment would be
 * created: a purchase that already has a persisted provider attempt is a retry/resume of a payment that
 * was legitimately initiated earlier (M146: "a payment initiated before a billing change is confirmed
 * exactly as before"), so it is reused unchanged and the webhook (M141) is untouched. A billing
 * failure is the SAME generic denial as any other "not payable" (reason `NOT_ELIGIBLE`, logged only).
 *
 * Every "you may not pay this" outcome (missing, someone else's, wrong status, legacy,
 * malformed snapshot, ineligible professional) is the same generic
 * LeadFeePaymentNotInitiableError.
 */
export class InitiateLeadFeePaymentUseCase {
  constructor(
    private readonly professionals: ProfessionalRepository,
    private readonly purchases: LeadPurchaseRepository,
    private readonly leads: LeadRepository,
    private readonly gateway: LeadFeePaymentGateway,
    private readonly eligibility: LeadPurchaseEligibilityEvaluator,
  ) {}

  async execute(userId: string, purchaseId: string): Promise<LeadFeePaymentInitiationDTO> {
    if (typeof userId !== "string" || userId === "" || typeof purchaseId !== "string" || !UUID.test(purchaseId)) {
      throw this.denied("INPUT");
    }

    const professional = await this.professionals.findByUserId(userId);
    // M98 gate, exactly as before M147 (same position, same reason): an inactive/unverified professional never pays, retry or not.
    if (!professional || !decideProfessionalVerificationEligibility(professional).eligible) throw this.denied("NOT_ELIGIBLE");

    const purchase = await this.purchases.findById(purchaseId);
    if (!purchase || purchase.professionalProfileId !== professional.id) throw this.denied("NOT_FOUND");

    const lead = await this.leads.findById(purchase.leadId);
    if (!lead || lead.flowVersion !== LEAD_FLOW_VERSION) throw this.denied("LEGACY");

    // Status + snapshot validation; the ONLY source of the amount.
    let terms: LeadFeePaymentTerms;
    try {
      terms = leadFeePaymentTermsFromPurchase(purchase);
    } catch (error) {
      if (error instanceof LeadFeePaymentNotInitiableError) logger.warn("lead_fee_payment.denied", { reason: error.reason });
      throw error;
    }

    if (purchase.paymentReference) {
      return this.respond(purchase.id, terms, await this.reuse(purchase.paymentReference, terms));
    }

    // Module 147: no provider payment exists yet -> a NEW one needs the full eligibility (incl. billing).
    const decision = await this.eligibility.evaluate(professional);
    if (!decision.eligible) {
      logger.warn("lead_fee_payment.denied", { reason: "NOT_ELIGIBLE", eligibilityReason: decision.reason });
      throw this.denied("NOT_ELIGIBLE");
    }

    const created = await this.provider(() =>
      this.gateway.createPayment({
        leadPurchaseId: purchase.id,
        leadId: purchase.leadId,
        amountMinorUnits: terms.totalMinorUnits,
        currency: terms.currency,
        idempotencyKey: leadFeePaymentIdempotencyKey(purchase.id),
      }),
    );
    if (!this.matches(created, terms)) {
      await this.discard(created.reference);
      throw this.unavailable("PROVIDER_MISMATCH");
    }

    const persisted = await this.purchases.recordPaymentReference(purchase.id, created.reference);
    if (persisted) return this.respond(purchase.id, terms, created);

    // Not persisted: re-read to learn why (terminal meanwhile, or a concurrent request won).
    const current = await this.purchases.findById(purchase.id);
    if (!current || current.status !== "PENDING_PAYMENT") {
      await this.discard(created.reference);
      throw this.denied("STATUS");
    }
    if (current.paymentReference === created.reference) return this.respond(purchase.id, terms, created);
    if (current.paymentReference) {
      await this.discard(created.reference);
      return this.respond(purchase.id, terms, await this.reuse(current.paymentReference, terms));
    }
    await this.discard(created.reference);
    throw this.unavailable("PROVIDER_ERROR");
  }

  /** Reads the persisted attempt and verifies it still is the right, usable payment. */
  private async reuse(reference: string, terms: LeadFeePaymentTerms): Promise<LeadFeeProviderPayment> {
    const existing = await this.provider(() => this.gateway.retrievePayment(reference));
    if (!this.matches(existing, terms) || existing.reference !== reference) throw this.unavailable("PROVIDER_MISMATCH");
    // The write-once reference can't be replaced; a canceled attempt is not payable (needs an operator / M141 decision).
    if (existing.status === "CANCELED") throw this.unavailable("PROVIDER_CANCELED");
    return existing;
  }

  private matches(payment: LeadFeeProviderPayment, terms: LeadFeePaymentTerms): boolean {
    return payment.amountMinorUnits === terms.totalMinorUnits && payment.currency.toUpperCase() === terms.currency;
  }

  private respond(purchaseId: string, terms: LeadFeePaymentTerms, payment: LeadFeeProviderPayment): LeadFeePaymentInitiationDTO {
    return {
      purchaseId,
      purchaseStatus: "PENDING_PAYMENT",
      clientSecret: payment.clientSecret,
      totalAmount: terms.totalAmount,
      currency: terms.currency,
      paymentStatus: payment.status,
    };
  }

  private async provider<T>(call: () => Promise<T>): Promise<T> {
    try {
      return await call();
    } catch (error) {
      if (error instanceof PaymentGatewayError) logger.warn("lead_fee_payment.provider_failed", { category: error.category });
      else logger.error("lead_fee_payment.provider_failed", { error: error instanceof Error ? error.message : "unknown" });
      throw this.unavailable("PROVIDER_ERROR");
    }
  }

  /** Cancels an attempt that must never be used. Failure is logged, never thrown (the caller already has a safer error). */
  private async discard(reference: string): Promise<void> {
    try {
      await this.gateway.cancelPayment(reference);
    } catch {
      logger.warn("lead_fee_payment.discard_failed", {});
    }
  }

  private denied(reason: LeadFeePaymentNotInitiableError["reason"]): LeadFeePaymentNotInitiableError {
    return new LeadFeePaymentNotInitiableError(reason);
  }

  private unavailable(reason: LeadFeePaymentUnavailableError["reason"]): LeadFeePaymentUnavailableError {
    return new LeadFeePaymentUnavailableError(reason);
  }
}
