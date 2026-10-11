import { Prisma, type LeadQualityClaim } from "@prisma/client";

import { prisma } from "@/infrastructure/database/prisma/client";
import {
  LeadQualityClaimInsertConflictError,
  buildLeadQualityClaimAuditEntry,
  type LeadQualityClaimAuditAction,
  type LeadQualityClaimConflictReason,
  type LeadQualityClaimDraft,
  type LeadQualityClaimRecord,
  type LeadQualityClaimRepository,
} from "@/domain/repositories/lead-quality-claim-repository";
import type { LeadQualityClaimDecision, LeadQualityClaimStatus } from "@/domain/services/lead-quality-claim";
import { recordAdminAuditLogWithin } from "@/infrastructure/database/prisma/repositories/prisma-admin-audit-log-repository";

/**
 * Placeholder for the two NOT NULL timestamp columns Prisma insists on. The insert trigger ALWAYS overwrites `submittedAt` with the
 * database clock and `respondBy` with `submittedAt + 72h`; a row that kept the epoch would be an obvious failure of the trigger.
 */
const SUBMITTED_AT_PLACEHOLDER = new Date(0);
const RESPOND_BY_PLACEHOLDER = new Date(72 * 3_600_000);

type Tx = Parameters<Parameters<typeof prisma.$transaction>[0]>[0];

/** The database clock under the caller's row lock: audit entries of one claim therefore carry non-decreasing times in commit order. */
async function databaseNow(tx: Tx): Promise<Date> {
  const rows = await tx.$queryRaw<{ t: Date }[]>`SELECT (clock_timestamp() AT TIME ZONE 'UTC') AS "t"`;
  const t = rows[0]?.t;
  if (!t) throw new Error("Could not read the database clock.");
  return t;
}

async function writeAudit(
  tx: Tx,
  action: LeadQualityClaimAuditAction,
  actorUserId: string,
  row: LeadQualityClaim,
  fromStatus: LeadQualityClaimStatus | null,
): Promise<void> {
  await recordAdminAuditLogWithin(tx, buildLeadQualityClaimAuditEntry(action, actorUserId, toLeadQualityClaimRecord(row), fromStatus), await databaseNow(tx));
}

export function toLeadQualityClaimRecord(row: LeadQualityClaim): LeadQualityClaimRecord {
  return {
    id: row.id,
    leadPurchaseId: row.leadPurchaseId,
    professionalProfileId: row.professionalProfileId,
    reasonCode: row.reasonCode,
    status: row.status,
    description: row.description,
    evidenceReference: row.evidenceReference,
    submittedAt: row.submittedAt,
    respondBy: row.respondBy,
    reviewStartedAt: row.reviewStartedAt,
    reviewStartedByUserId: row.reviewStartedByUserId,
    decidedAt: row.decidedAt,
    decidedByUserId: row.decidedByUserId,
    decisionExplanation: row.decisionExplanation,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

/** Maps the insert trigger's messages (check_violation) to closed conflict reasons. */
function conflictReasonOf(error: unknown): LeadQualityClaimConflictReason | null {
  if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") return "ALREADY_CLAIMED";
  const message = error instanceof Error ? error.message : "";
  if (/lead_quality_claims open claim limit/.test(message)) return "OPEN_CLAIM_LIMIT_REACHED";
  if (/lead_quality_claims period claim limit/.test(message)) return "PERIOD_CLAIM_LIMIT_REACHED";
  if (/lead_quality_claims claim window/.test(message)) return "CLAIM_WINDOW_CLOSED";
  if (/lead_quality_claims claim is not for a CONFIRMED purchase|lead_quality_claims requires an existing professional/.test(message)) {
    return "PURCHASE_NOT_CLAIMABLE";
  }
  return null;
}

/**
 * Module 154 — Prisma adapter of `lead_quality_claims`. Only `create`, reads and status-conditional `updateMany` are used:
 * no delete, no upsert and no update of any identity/content column (the DB triggers forbid it as well).
 *
 * H1 — every transition runs in ONE interactive transaction together with its append-only audit entry (`recordAdminAuditLogWithin`):
 * a failing audit insert rolls the claim change back and the error reaches the caller. Review-start and decision first lock the
 * row (`SELECT … FOR UPDATE`), so concurrent transitions of one claim are strictly serialized, the recorded `fromStatus` is the TRUE
 * previous status (read under the lock) and the audit entries come out in the order the transitions committed.
 */
export class PrismaLeadQualityClaimRepository implements LeadQualityClaimRepository {
  async findById(id: string): Promise<LeadQualityClaimRecord | null> {
    const row = await prisma.leadQualityClaim.findUnique({ where: { id } });
    return row ? toLeadQualityClaimRecord(row) : null;
  }

  async findByLeadPurchaseId(leadPurchaseId: string): Promise<LeadQualityClaimRecord | null> {
    const row = await prisma.leadQualityClaim.findUnique({ where: { leadPurchaseId } });
    return row ? toLeadQualityClaimRecord(row) : null;
  }

  countOpenByProfessional(professionalProfileId: string): Promise<number> {
    return prisma.leadQualityClaim.count({ where: { professionalProfileId, status: { in: ["SUBMITTED", "UNDER_REVIEW"] } } });
  }

  countSubmittedSince(professionalProfileId: string, since: Date): Promise<number> {
    return prisma.leadQualityClaim.count({ where: { professionalProfileId, submittedAt: { gt: since } } });
  }

  async isClaimOwnedByUser(claimId: string, userId: string): Promise<boolean> {
    const claim = await prisma.leadQualityClaim.findUnique({ where: { id: claimId }, select: { professionalProfileId: true } });
    if (!claim) return false;
    // Deliberately NOT filtered by `deletedAt`: ownership of a soft-deleted profile is still ownership.
    return (await prisma.professionalProfile.count({ where: { id: claim.professionalProfileId, userId } })) > 0;
  }

  async create(draft: LeadQualityClaimDraft, actorUserId: string): Promise<LeadQualityClaimRecord> {
    try {
      const row = await prisma.$transaction(async (tx) => {
        const created = await tx.leadQualityClaim.create({
          data: {
            leadPurchaseId: draft.leadPurchaseId,
            professionalProfileId: draft.professionalProfileId,
            reasonCode: draft.reasonCode,
            status: "SUBMITTED",
            description: draft.description,
            evidenceReference: draft.evidenceReference,
            submittedAt: SUBMITTED_AT_PLACEHOLDER, // overwritten by the insert trigger with the database clock
            respondBy: RESPOND_BY_PLACEHOLDER, // overwritten by the insert trigger (= submittedAt + 72h)
          },
        });
        await writeAudit(tx, "LEAD_QUALITY_CLAIM_SUBMITTED", actorUserId, created, null);
        return created;
      });
      return toLeadQualityClaimRecord(row);
    } catch (error) {
      const reason = conflictReasonOf(error);
      if (reason) throw new LeadQualityClaimInsertConflictError(reason);
      throw error;
    }
  }

  async markReviewStarted(id: string, actorUserId: string, at: Date): Promise<LeadQualityClaimRecord | null> {
    return prisma.$transaction(async (tx) => {
      const before = await lockStatus(tx, id);
      if (before !== "SUBMITTED") return null;
      const result = await tx.leadQualityClaim.updateMany({
        where: { id, status: "SUBMITTED" },
        data: { status: "UNDER_REVIEW", reviewStartedAt: at, reviewStartedByUserId: actorUserId },
      });
      if (result.count === 0) return null;
      const row = await tx.leadQualityClaim.findUniqueOrThrow({ where: { id } });
      await writeAudit(tx, "LEAD_QUALITY_CLAIM_REVIEW_STARTED", actorUserId, row, before);
      return toLeadQualityClaimRecord(row);
    });
  }

  async decide(
    id: string,
    decision: { to: LeadQualityClaimDecision; actorUserId: string; explanation: string; at: Date },
  ): Promise<LeadQualityClaimRecord | null> {
    return prisma.$transaction(async (tx) => {
      const before = await lockStatus(tx, id);
      if (before !== "SUBMITTED" && before !== "UNDER_REVIEW") return null;
      const result = await tx.leadQualityClaim.updateMany({
        where: { id, status: { in: ["SUBMITTED", "UNDER_REVIEW"] } },
        data: { status: decision.to, decidedAt: decision.at, decidedByUserId: decision.actorUserId, decisionExplanation: decision.explanation },
      });
      if (result.count === 0) return null;
      const row = await tx.leadQualityClaim.findUniqueOrThrow({ where: { id } });
      await writeAudit(tx, decision.to === "APPROVED" ? "LEAD_QUALITY_CLAIM_APPROVED" : "LEAD_QUALITY_CLAIM_REJECTED", decision.actorUserId, row, before);
      return toLeadQualityClaimRecord(row);
    });
  }
}

/** Locks the claim row and returns its CURRENT status (null when it does not exist). */
async function lockStatus(tx: Tx, id: string): Promise<LeadQualityClaimStatus | null> {
  const rows = await tx.$queryRaw<{ status: LeadQualityClaimStatus }[]>`
    SELECT "status"::text AS "status" FROM "lead_quality_claims" WHERE "id" = ${id}::uuid FOR UPDATE`;
  return rows[0]?.status ?? null;
}
