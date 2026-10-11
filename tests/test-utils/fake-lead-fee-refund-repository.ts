import {
  LeadFeeRefundAttemptConflictError,
  LeadFeeRefundTransitionConflictError,
  type LeadFeeRefundDraft,
  type LeadFeeRefundRecord,
  type LeadFeeRefundRepository,
  type LeadFeeRefundStatusUpdate,
} from "@/domain/repositories/lead-fee-refund-repository";
import { LEAD_FEE_REFUND_ACTIVE_STATUSES } from "@/domain/services/lead-fee-refund";

/**
 * Module 153 test double (tests only): an in-memory `LeadFeeRefundRepository` that enforces the same rules the
 * database does (one ACTIVE attempt per payment, unique attempt number / idempotency key, forward-only conditional status moves).
 */
export class FakeLeadFeeRefundRepository implements LeadFeeRefundRepository {
  readonly rows: LeadFeeRefundRecord[] = [];
  private seq = 0;
  failUpdate: Error | null = null;

  async listByPaymentReference(paymentReference: string): Promise<LeadFeeRefundRecord[]> {
    return this.rows
      .filter((r) => r.refundedPaymentReference === paymentReference)
      .sort((a, b) => a.attemptNumber - b.attemptNumber)
      .map((r) => ({ ...r }));
  }

  async createAttempt(draft: LeadFeeRefundDraft): Promise<LeadFeeRefundRecord> {
    const sameKey = this.rows.some((r) => r.idempotencyKey === draft.idempotencyKey);
    const sameNumber = this.rows.some((r) => r.refundedPaymentReference === draft.refundedPaymentReference && r.attemptNumber === draft.attemptNumber);
    const active = this.rows.some(
      (r) => r.refundedPaymentReference === draft.refundedPaymentReference && (LEAD_FEE_REFUND_ACTIVE_STATUSES as readonly string[]).includes(r.status),
    );
    if (sameKey || sameNumber || active) throw new LeadFeeRefundAttemptConflictError();
    const now = new Date();
    const row: LeadFeeRefundRecord = {
      id: `00000000-0000-4000-8000-${String(++this.seq).padStart(12, "0")}`,
      ...draft,
      status: "REQUESTED",
      providerRefundId: null,
      failureCategory: null,
      purchaseTransitionedAt: null,
      createdAt: now,
      updatedAt: now,
    };
    this.rows.push(row);
    return { ...row };
  }

  async updateStatus(id: string, update: LeadFeeRefundStatusUpdate): Promise<LeadFeeRefundRecord> {
    if (this.failUpdate) throw this.failUpdate;
    const row = this.rows.find((r) => r.id === id);
    if (!row || !update.from.includes(row.status)) throw new LeadFeeRefundTransitionConflictError();
    row.status = update.to;
    if (update.providerRefundId !== undefined) row.providerRefundId = update.providerRefundId;
    if (update.failureCategory !== undefined) row.failureCategory = update.failureCategory;
    row.updatedAt = new Date();
    return { ...row };
  }

  async markPurchaseTransitioned(id: string, at: Date): Promise<boolean> {
    const row = this.rows.find((r) => r.id === id);
    if (!row || row.status !== "SUCCEEDED" || row.reasonCode !== "PLATFORM_ERROR" || row.purchaseTransitionedAt !== null) return false;
    row.purchaseTransitionedAt = at;
    return true;
  }
}
