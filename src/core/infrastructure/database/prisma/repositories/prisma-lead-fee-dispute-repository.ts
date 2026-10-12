import { Prisma, type LeadFeeDispute } from "@prisma/client";

import { prisma } from "@/infrastructure/database/prisma/client";
import {
  LeadFeeDisputeAssociationConflictError,
  LeadFeeDisputeEvidenceConflictError,
  type ApplyLeadFeeDisputeEventCommand,
  type ApplyLeadFeeDisputeEventResult,
  type ClaimLeadFeeDisputeEvidenceInput,
  type LeadFeeDisputeRecord,
  type LeadFeeDisputeRepository,
  type LeadPurchaseRevocationRepository,
  type ReconcileLeadPurchaseDisputesResult,
  type RevokeLeadPurchaseCommand,
  type RevokeLeadPurchaseResult,
} from "@/domain/repositories/lead-fee-dispute-repository";
import {
  LeadFeeDisputeRejectedError,
  canTransitionLeadFeeDispute,
  decideLeadFeeDisputesPurchaseEffect,
  summarizePlatformRefundState,
  isLeadFeeDisputeStatus,
  isOpenLeadFeeDisputeStatus,
  minorUnitsToDecimal,
  purchaseStatusAfterEffect,
  validateLeadFeeDisputeAgainstPurchase,
  type LeadFeeDisputePurchaseEffect,
  type LeadFeeDisputeStatus,
} from "@/domain/services/lead-fee-dispute";
import { isLeadPurchaseStatus, type LeadPurchaseStatus } from "@/domain/services/lead-purchase";
import { formatScaledDecimal, parseScaledDecimal } from "@/domain/services/fixed-point-decimal";
import { recordAdminAuditLogWithin } from "@/infrastructure/database/prisma/repositories/prisma-admin-audit-log-repository";
import type { AdminAuditAction } from "@/domain/repositories/admin-audit-log-repository";

type Tx = Parameters<Parameters<typeof prisma.$transaction>[0]>[0];

const REASON_MAX = 100;

interface LockedPurchase {
  id: string;
  status: LeadPurchaseStatus;
  paymentReference: string | null;
  currency: string;
  totalAmount: string | null;
}

/** Row lock on the purchase: every writer that changes a purchase's dispute state queues here, in this order (purchase, then dispute). */
async function lockPurchase(tx: Tx, leadPurchaseId: string): Promise<LockedPurchase | null> {
  const rows = await tx.$queryRaw<{ id: string; status: string; paymentReference: string | null; currency: string; totalAmount: string | null }[]>`
    SELECT "id"::text AS "id", "status"::text AS "status", "paymentReference", "currency", "totalAmount"::text AS "totalAmount"
    FROM "lead_purchases" WHERE "id" = ${leadPurchaseId}::uuid FOR UPDATE`;
  const row = rows[0];
  if (!row) return null;
  if (!isLeadPurchaseStatus(row.status)) throw new Error(`Unknown LeadPurchase status "${row.status}".`);
  return {
    id: row.id,
    status: row.status,
    paymentReference: row.paymentReference,
    currency: row.currency,
    totalAmount: row.totalAmount === null ? null : exactMoney(row.totalAmount),
  };
}

async function lockDisputeRow(tx: Tx, disputeId: string): Promise<void> {
  await tx.$queryRaw`SELECT "id" FROM "lead_fee_disputes" WHERE "id" = ${disputeId}::uuid FOR UPDATE`;
}

/**
 * Module 155 H1 — the statuses of the purchase's PLATFORM_ERROR refund attempts (Module 153), READ ONLY (this module never writes the
 * refund table). Called while the purchase row is locked FOR UPDATE: M153's insert trigger takes FOR SHARE on that same row, so a refund
 * attempt cannot be created concurrently with this decision, and every refund status that matters here is monotonic (an attempt only
 * moves towards SUCCEEDED / FAILED), so a stale read can only keep the purchase DISPUTED, never restore it wrongly. The database
 * trigger `lead_purchases_dispute_guard` independently refuses DISPUTED -> CONFIRMED while such a refund exists.
 */
async function platformRefundStatuses(tx: Tx, leadPurchaseId: string): Promise<string[]> {
  const rows = await tx.$queryRaw<{ status: string }[]>`
    SELECT "status"::text AS "status" FROM "lead_fee_refunds"
    WHERE "leadPurchaseId" = ${leadPurchaseId}::uuid AND "reasonCode" = 'PLATFORM_ERROR'`;
  return rows.map((r) => r.status);
}

function exactMoney(value: unknown): string {
  const parsed = parseScaledDecimal(String(value), 2);
  if (parsed === null) throw new Error("Not a valid Decimal(10,2).");
  return formatScaledDecimal(parsed, 2, 2);
}

export function toLeadFeeDisputeRecord(row: LeadFeeDispute): LeadFeeDisputeRecord {
  if (!isLeadFeeDisputeStatus(row.status)) throw new Error(`Unknown LeadFeeDispute status "${row.status}".`);
  return {
    id: row.id,
    providerDisputeId: row.providerDisputeId,
    leadPurchaseId: row.leadPurchaseId,
    paymentReference: row.paymentReference,
    providerChargeId: row.providerChargeId,
    status: row.status,
    amount: exactMoney(row.amount),
    currency: row.currency,
    reason: row.reason,
    evidenceDueBy: row.evidenceDueBy,
    openedAt: row.openedAt,
    closedAt: row.closedAt,
    lastProviderEventId: row.lastProviderEventId,
    lastProviderEventAt: row.lastProviderEventAt,
    evidenceStatus: row.evidenceStatus,
    evidenceReference: row.evidenceReference,
    evidenceText: row.evidenceText,
    evidenceActorUserId: row.evidenceActorUserId,
    evidenceRequestedAt: row.evidenceRequestedAt,
    evidenceSubmittedAt: row.evidenceSubmittedAt,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

const PURCHASE_AUDIT_ACTION: Record<Exclude<LeadFeeDisputePurchaseEffect, "NONE">, AdminAuditAction> = {
  SUSPEND: "LEAD_PURCHASE_ACCESS_SUSPENDED",
  RESTORE: "LEAD_PURCHASE_ACCESS_RESTORED",
  REVOKE: "LEAD_PURCHASE_REVOKED",
  REFUND: "LEAD_PURCHASE_REFUND_CONVERGED",
};

/**
 * Module 155 — Prisma implementation of `LeadFeeDisputeRepository`.
 *
 * Concurrency model: every change of a purchase's dispute state first takes `SELECT ... FOR UPDATE` on the PURCHASE row, so
 * concurrent events about the same payment (a retried delivery under a new event id, `updated` racing `closed`, a dispute racing the
 * payment confirmation or an administrative revocation) are serialized and each sees the previous one's committed result. The
 * purchase transition itself is status-conditional (`UPDATE ... WHERE status = <expected>`) and must match exactly one row, and the
 * DB trigger `lead_purchases_dispute_guard` refuses an illegal combination of purchase and dispute state regardless of this code.
 * The dispute change, the purchase change, the revocation record and the audit entries are ONE transaction.
 */
export class PrismaLeadFeeDisputeRepository implements LeadFeeDisputeRepository {
  async applyEvent(command: ApplyLeadFeeDisputeEventCommand): Promise<ApplyLeadFeeDisputeEventResult> {
    try {
      return await prisma.$transaction(async (tx) => {
        const purchase = await lockPurchase(tx, command.leadPurchaseId);
        if (!purchase) throw new LeadFeeDisputeRejectedError("PAYMENT_REFERENCE_MISSING");

        // Re-validated under the lock (the facts are immutable, but the transaction never trusts a caller-side read).
        const rejection = validateLeadFeeDisputeAgainstPurchase(command.dispute, purchase);
        if (rejection) throw new LeadFeeDisputeRejectedError(rejection);

        const existing = await tx.leadFeeDispute.findUnique({ where: { providerDisputeId: command.dispute.providerDisputeId } });
        let dispute: LeadFeeDispute;
        let created = false;
        let statusChanged = false;
        let previousStatus: LeadFeeDisputeStatus | null = null;

        if (!existing) {
          const terminal = !isOpenLeadFeeDisputeStatus(command.status);
          dispute = await tx.leadFeeDispute.create({
            data: {
              providerDisputeId: command.dispute.providerDisputeId,
              leadPurchaseId: command.leadPurchaseId,
              paymentReference: command.dispute.paymentReference as string,
              providerChargeId: command.dispute.providerChargeId as string,
              status: command.status,
              amount: minorUnitsToDecimal(command.dispute.amountMinorUnits as number),
              currency: "EUR",
              reason: command.dispute.reason === null ? null : command.dispute.reason.slice(0, REASON_MAX),
              evidenceDueBy: command.dispute.evidenceDueBy,
              openedAt: command.providerEventAt,
              closedAt: terminal ? command.providerEventAt : null,
              lastProviderEventId: command.providerEventId,
              lastProviderEventAt: command.providerEventAt,
            },
          });
          created = true;
        } else {
          if (
            existing.leadPurchaseId !== command.leadPurchaseId ||
            existing.paymentReference !== command.dispute.paymentReference ||
            existing.providerChargeId !== command.dispute.providerChargeId
          ) {
            throw new LeadFeeDisputeAssociationConflictError();
          }
          await lockDisputeRow(tx, existing.id);
          const locked = await tx.leadFeeDispute.findUniqueOrThrow({ where: { id: existing.id } });
          dispute = locked;
          if (isLeadFeeDisputeStatus(locked.status) && canTransitionLeadFeeDispute(locked.status, command.status)) {
            previousStatus = locked.status;
            const terminal = !isOpenLeadFeeDisputeStatus(command.status);
            const eventAt = command.providerEventAt > locked.lastProviderEventAt ? command.providerEventAt : locked.lastProviderEventAt;
            const { count } = await tx.leadFeeDispute.updateMany({
              where: { id: locked.id, status: locked.status },
              data: {
                status: command.status,
                closedAt: terminal ? command.providerEventAt : null,
                lastProviderEventId: command.providerEventAt >= locked.lastProviderEventAt ? command.providerEventId : locked.lastProviderEventId,
                lastProviderEventAt: eventAt,
                ...(command.dispute.evidenceDueBy ? { evidenceDueBy: command.dispute.evidenceDueBy } : {}),
              },
            });
            if (count !== 1) throw new Error("The dispute changed under its own lock.");
            dispute = await tx.leadFeeDispute.findUniqueOrThrow({ where: { id: locked.id } });
            statusChanged = true;
          }
          // A replay, a duplicate under another event id, a stale or an out-of-order event: no dispute change at all.
        }

        const outcome = await this.converge(tx, purchase, dispute, command.now, command.providerEventId);

        if (created) {
          await recordAdminAuditLogWithin(tx, {
            adminUserId: null,
            action: "LEAD_FEE_DISPUTE_RECORDED",
            targetType: "LeadFeeDispute",
            targetId: dispute.id,
            metadata: { leadPurchaseId: purchase.id, status: dispute.status, providerEventId: command.providerEventId },
          });
        } else if (statusChanged) {
          await recordAdminAuditLogWithin(tx, {
            adminUserId: null,
            action: "LEAD_FEE_DISPUTE_STATUS_CHANGED",
            targetType: "LeadFeeDispute",
            targetId: dispute.id,
            metadata: { leadPurchaseId: purchase.id, fromStatus: previousStatus, toStatus: dispute.status, providerEventId: command.providerEventId },
          });
        }

        return {
          dispute: toLeadFeeDisputeRecord(dispute),
          created,
          statusChanged,
          purchaseStatusBefore: purchase.status,
          purchaseStatusAfter: outcome.after,
          effect: outcome.effect,
        };
      });
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
        // A concurrent insert of the SAME provider dispute id for a DIFFERENT purchase: the dispute is already bound elsewhere.
        throw new LeadFeeDisputeAssociationConflictError();
      }
      throw error;
    }
  }

  async reconcilePurchase(leadPurchaseId: string, now: Date): Promise<ReconcileLeadPurchaseDisputesResult | null> {
    return prisma.$transaction(async (tx) => {
      const purchase = await lockPurchase(tx, leadPurchaseId);
      if (!purchase) return null;
      const outcome = await this.converge(tx, purchase, null, now, null);
      return { purchaseStatusBefore: purchase.status, purchaseStatusAfter: outcome.after, effect: outcome.effect };
    });
  }

  /**
   * Brings the (locked) purchase in line with ALL its recorded disputes and writes the audit entry of the purchase change.
   * Returns effect NONE and writes nothing when the purchase already is where its disputes require it to be.
   */
  private async converge(
    tx: Tx,
    purchase: LockedPurchase,
    trigger: LeadFeeDispute | null,
    now: Date,
    providerEventId: string | null,
  ): Promise<{ effect: LeadFeeDisputePurchaseEffect; after: LeadPurchaseStatus }> {
    const disputes = await tx.leadFeeDispute.findMany({ where: { leadPurchaseId: purchase.id }, orderBy: [{ openedAt: "asc" }, { id: "asc" }] });
    const statuses = disputes.map((d) => d.status).filter(isLeadFeeDisputeStatus);
    // The refund state only matters when the purchase is DISPUTED (it is read under the purchase lock, see the helper).
    const refund = purchase.status === "DISPUTED" ? summarizePlatformRefundState(await platformRefundStatuses(tx, purchase.id)) : "NONE";
    const effect = decideLeadFeeDisputesPurchaseEffect(purchase.status, statuses, refund);
    if (effect === "NONE") return { effect, after: purchase.status };

    const after = purchaseStatusAfterEffect(effect, purchase.status);
    const { count } = await tx.leadPurchase.updateMany({
      where: { id: purchase.id, status: purchase.status },
      // The ORIGINAL confirmedAt is never touched; only a revocation stamps its own timestamp.
      data: effect === "REVOKE" ? { status: after, revokedAt: now } : effect === "REFUND" ? { status: after, refundedAt: now } : { status: after },
    });
    if (count !== 1) throw new Error("The purchase changed under its own lock.");

    let revocationDisputeId: string | null = null;
    if (effect === "REVOKE") {
      const lost = disputes.find((d) => d.status === "LOST") ?? trigger;
      if (!lost) throw new Error("A revocation needs a LOST dispute.");
      revocationDisputeId = lost.id;
      await tx.leadPurchaseRevocation.create({ data: { leadPurchaseId: purchase.id, source: "DISPUTE_LOST", leadFeeDisputeId: lost.id } });
    }

    await recordAdminAuditLogWithin(tx, {
      adminUserId: null,
      action: PURCHASE_AUDIT_ACTION[effect],
      targetType: "LeadPurchase",
      targetId: purchase.id,
      metadata: {
        fromStatus: purchase.status,
        toStatus: after,
        disputeId: revocationDisputeId ?? trigger?.id ?? disputes[0]?.id ?? null,
        providerEventId,
      },
    });
    return { effect, after };
  }

  async findById(id: string): Promise<LeadFeeDisputeRecord | null> {
    const row = await prisma.leadFeeDispute.findUnique({ where: { id } });
    return row ? toLeadFeeDisputeRecord(row) : null;
  }

  async findByProviderDisputeId(providerDisputeId: string): Promise<LeadFeeDisputeRecord | null> {
    const row = await prisma.leadFeeDispute.findUnique({ where: { providerDisputeId } });
    return row ? toLeadFeeDisputeRecord(row) : null;
  }

  async listByPurchaseId(leadPurchaseId: string): Promise<LeadFeeDisputeRecord[]> {
    const rows = await prisma.leadFeeDispute.findMany({ where: { leadPurchaseId }, orderBy: [{ openedAt: "asc" }, { id: "asc" }] });
    return rows.map(toLeadFeeDisputeRecord);
  }

  async claimEvidenceSubmission(input: ClaimLeadFeeDisputeEvidenceInput): Promise<LeadFeeDisputeRecord> {
    return prisma.$transaction(async (tx) => {
      await lockDisputeRow(tx, input.disputeId);
      const { count } = await tx.leadFeeDispute.updateMany({
        where: { id: input.disputeId, status: "NEEDS_RESPONSE", evidenceStatus: "NOT_SUBMITTED" },
        data: {
          evidenceStatus: "SUBMISSION_PENDING",
          evidenceReference: input.evidenceReference,
          evidenceText: input.evidenceText,
          evidenceActorUserId: input.actorUserId,
          evidenceRequestedAt: input.now,
        },
      });
      if (count !== 1) throw new LeadFeeDisputeEvidenceConflictError();
      const row = await tx.leadFeeDispute.findUniqueOrThrow({ where: { id: input.disputeId } });
      await recordAdminAuditLogWithin(tx, {
        adminUserId: input.actorUserId,
        action: "LEAD_FEE_DISPUTE_EVIDENCE_REQUESTED",
        targetType: "LeadFeeDispute",
        targetId: row.id,
        metadata: { leadPurchaseId: row.leadPurchaseId },
      });
      return toLeadFeeDisputeRecord(row);
    });
  }

  async markEvidenceSubmitted(disputeId: string, actorUserId: string, now: Date): Promise<LeadFeeDisputeRecord> {
    return prisma.$transaction(async (tx) => {
      await lockDisputeRow(tx, disputeId);
      const current = await tx.leadFeeDispute.findUnique({ where: { id: disputeId } });
      if (!current) throw new LeadFeeDisputeEvidenceConflictError();
      if (current.evidenceStatus === "SUBMITTED") return toLeadFeeDisputeRecord(current);
      const { count } = await tx.leadFeeDispute.updateMany({
        where: { id: disputeId, evidenceStatus: "SUBMISSION_PENDING" },
        data: { evidenceStatus: "SUBMITTED", evidenceSubmittedAt: now },
      });
      if (count !== 1) throw new LeadFeeDisputeEvidenceConflictError();
      const row = await tx.leadFeeDispute.findUniqueOrThrow({ where: { id: disputeId } });
      await recordAdminAuditLogWithin(tx, {
        adminUserId: actorUserId,
        action: "LEAD_FEE_DISPUTE_EVIDENCE_SUBMITTED",
        targetType: "LeadFeeDispute",
        targetId: row.id,
        metadata: { leadPurchaseId: row.leadPurchaseId },
      });
      return toLeadFeeDisputeRecord(row);
    });
  }

  async releaseEvidenceClaim(disputeId: string): Promise<LeadFeeDisputeRecord> {
    return prisma.$transaction(async (tx) => {
      await lockDisputeRow(tx, disputeId);
      const { count } = await tx.leadFeeDispute.updateMany({
        where: { id: disputeId, evidenceStatus: "SUBMISSION_PENDING" },
        data: {
          evidenceStatus: "NOT_SUBMITTED",
          evidenceReference: null,
          evidenceText: null,
          evidenceActorUserId: null,
          evidenceRequestedAt: null,
          evidenceSubmittedAt: null,
        },
      });
      if (count !== 1) throw new LeadFeeDisputeEvidenceConflictError();
      return toLeadFeeDisputeRecord(await tx.leadFeeDispute.findUniqueOrThrow({ where: { id: disputeId } }));
    });
  }
}

/**
 * Module 155 — administrative revocation (CONFIRMED -> REVOKED, no refund executed). One transaction with the revocation
 * record and the audit entry; status-conditional under the purchase row lock.
 */
export class PrismaLeadPurchaseRevocationRepository implements LeadPurchaseRevocationRepository {
  async revokeConfirmed(command: RevokeLeadPurchaseCommand): Promise<RevokeLeadPurchaseResult> {
    return prisma.$transaction(async (tx) => {
      const purchase = await lockPurchase(tx, command.leadPurchaseId);
      if (!purchase) throw new LeadFeeDisputeRejectedError("PURCHASE_NOT_FOUND");
      if (purchase.status === "REVOKED") {
        return { purchaseStatusBefore: "REVOKED", purchaseStatusAfter: "REVOKED", revoked: false, revocationId: null };
      }
      if (purchase.status !== "CONFIRMED") throw new LeadFeeDisputeRejectedError("PURCHASE_NOT_CONFIRMED");

      const { count } = await tx.leadPurchase.updateMany({
        where: { id: purchase.id, status: "CONFIRMED" },
        data: { status: "REVOKED", revokedAt: command.now },
      });
      if (count !== 1) throw new Error("The purchase changed under its own lock.");
      const revocation = await tx.leadPurchaseRevocation.create({
        data: {
          leadPurchaseId: purchase.id,
          source: "ADMIN",
          actorUserId: command.actorUserId,
          explanation: command.explanation,
          evidenceReference: command.evidenceReference,
        },
      });
      await recordAdminAuditLogWithin(tx, {
        adminUserId: command.actorUserId,
        action: "LEAD_PURCHASE_REVOKED",
        targetType: "LeadPurchase",
        targetId: purchase.id,
        metadata: { fromStatus: "CONFIRMED", toStatus: "REVOKED", source: "ADMIN", revocationId: revocation.id },
      });
      return { purchaseStatusBefore: "CONFIRMED", purchaseStatusAfter: "REVOKED", revoked: true, revocationId: revocation.id };
    });
  }
}
