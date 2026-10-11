import { Prisma, type LeadFeeRefund } from "@prisma/client";

import { prisma } from "@/infrastructure/database/prisma/client";
import {
  LeadFeeRefundAttemptConflictError,
  LeadFeeRefundTransitionConflictError,
  type LeadFeeRefundDraft,
  type LeadFeeRefundRecord,
  type LeadFeeRefundRepository,
  type LeadFeeRefundStatusUpdate,
} from "@/domain/repositories/lead-fee-refund-repository";

/** Maps a row; money stays a decimal STRING (never a JS number). */
export function toLeadFeeRefundRecord(row: LeadFeeRefund): LeadFeeRefundRecord {
  return {
    id: row.id,
    leadPurchaseId: row.leadPurchaseId,
    reasonCode: row.reasonCode,
    attemptNumber: row.attemptNumber,
    status: row.status,
    amount: row.amount.toFixed(2),
    currency: row.currency,
    refundedPaymentReference: row.refundedPaymentReference,
    purchasePaymentReference: row.purchasePaymentReference,
    idempotencyKey: row.idempotencyKey,
    providerRefundId: row.providerRefundId,
    actorUserId: row.actorUserId,
    explanation: row.explanation,
    evidenceReference: row.evidenceReference,
    failureCategory: row.failureCategory,
    purchaseTransitionedAt: row.purchaseTransitionedAt,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

/**
 * Module 153 — Prisma adapter of `lead_fee_refunds`. Only `create`, `findMany`, `findUniqueOrThrow` and conditional
 * `updateMany` are used: no delete, no upsert, and no update of any money/identity column (the DB triggers also forbid it).
 */
export class PrismaLeadFeeRefundRepository implements LeadFeeRefundRepository {
  async listByPaymentReference(paymentReference: string): Promise<LeadFeeRefundRecord[]> {
    const rows = await prisma.leadFeeRefund.findMany({ where: { refundedPaymentReference: paymentReference }, orderBy: { attemptNumber: "asc" } });
    return rows.map(toLeadFeeRefundRecord);
  }

  async createAttempt(draft: LeadFeeRefundDraft): Promise<LeadFeeRefundRecord> {
    try {
      const row = await prisma.leadFeeRefund.create({
        data: {
          leadPurchaseId: draft.leadPurchaseId,
          reasonCode: draft.reasonCode,
          attemptNumber: draft.attemptNumber,
          status: "REQUESTED",
          amount: draft.amount,
          currency: draft.currency,
          refundedPaymentReference: draft.refundedPaymentReference,
          purchasePaymentReference: draft.purchasePaymentReference,
          idempotencyKey: draft.idempotencyKey,
          actorUserId: draft.actorUserId,
          explanation: draft.explanation,
          evidenceReference: draft.evidenceReference,
        },
      });
      return toLeadFeeRefundRecord(row);
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") throw new LeadFeeRefundAttemptConflictError();
      // The insert trigger rejects a retry whose predecessor is not FAILED / a first attempt that already exists (check_violation).
      // Matched on the database message, whatever error class the driver surfaces it as.
      if (error instanceof Error && /lead_fee_refunds (retry requires|first attempt already exists)/.test(error.message)) {
        throw new LeadFeeRefundAttemptConflictError();
      }
      throw error;
    }
  }

  async updateStatus(id: string, update: LeadFeeRefundStatusUpdate): Promise<LeadFeeRefundRecord> {
    const result = await prisma.leadFeeRefund.updateMany({
      where: { id, status: { in: [...update.from] } },
      data: {
        status: update.to,
        ...(update.providerRefundId !== undefined ? { providerRefundId: update.providerRefundId } : {}),
        ...(update.failureCategory !== undefined ? { failureCategory: update.failureCategory } : {}),
      },
    });
    if (result.count === 0) throw new LeadFeeRefundTransitionConflictError();
    return toLeadFeeRefundRecord(await prisma.leadFeeRefund.findUniqueOrThrow({ where: { id } }));
  }

  async markPurchaseTransitioned(id: string, at: Date): Promise<boolean> {
    const result = await prisma.leadFeeRefund.updateMany({
      where: { id, status: "SUCCEEDED", reasonCode: "PLATFORM_ERROR", purchaseTransitionedAt: null },
      data: { purchaseTransitionedAt: at },
    });
    return result.count === 1;
  }
}
