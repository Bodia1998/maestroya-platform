import { prisma } from "@/infrastructure/database/prisma/client";
import type {
  LeadContactSharingRecordData,
  LeadContactSharingRepository,
  RecordLeadContactSharingData,
} from "@/domain/repositories/lead-privacy-repository";
import { isLeadContactSharingBasis } from "@/domain/services/lead-privacy";

const SELECT = {
  id: true,
  leadId: true,
  userId: true,
  basis: true,
  noticeVersion: true,
  recordedAt: true,
  withdrawnAt: true,
} as const;

type Row = {
  id: string;
  leadId: string;
  userId: string;
  basis: string;
  noticeVersion: string;
  recordedAt: Date;
  withdrawnAt: Date | null;
};

function toRecord(row: Row): LeadContactSharingRecordData {
  // A basis outside the closed vocabulary can only come from a corrupted row; failing loudly beats guessing a lawful basis.
  if (!isLeadContactSharingBasis(row.basis)) throw new Error("Unknown lead contact-sharing basis.");
  return {
    id: row.id,
    leadId: row.leadId,
    userId: row.userId,
    basis: row.basis,
    noticeVersion: row.noticeVersion,
    recordedAt: row.recordedAt,
    withdrawnAt: row.withdrawnAt,
  };
}

/**
 * Module 158 — Prisma adapter of `LeadContactSharingRepository` over `lead_contact_sharing_records`.
 * The single writer of that table. Every write is idempotent and conditional; the database triggers (identity columns immutable,
 * write-once CONSENT-only withdrawal, no delete, owner cross-check) are the backstop, not the primary control.
 */
export class PrismaLeadContactSharingRepository implements LeadContactSharingRepository {
  async record(data: RecordLeadContactSharingData): Promise<{ record: LeadContactSharingRecordData; created: boolean }> {
    // INSERT .. ON CONFLICT DO NOTHING semantics: the UNIQUE (leadId) decides the winner of concurrent calls.
    const { count } = await prisma.leadContactSharingRecord.createMany({
      data: [
        {
          leadId: data.leadId,
          userId: data.userId,
          basis: data.basis,
          noticeVersion: data.noticeVersion,
          recordedAt: data.recordedAt,
        },
      ],
      skipDuplicates: true,
    });
    const row = await prisma.leadContactSharingRecord.findUniqueOrThrow({ where: { leadId: data.leadId }, select: SELECT });
    return { record: toRecord(row), created: count === 1 };
  }

  async findByLeadId(leadId: string): Promise<LeadContactSharingRecordData | null> {
    const row = await prisma.leadContactSharingRecord.findUnique({ where: { leadId }, select: SELECT });
    return row ? toRecord(row) : null;
  }

  async withdraw(
    leadId: string,
    withdrawnAt: Date,
  ): Promise<{ record: LeadContactSharingRecordData | null; changed: boolean }> {
    const existing = await prisma.leadContactSharingRecord.findUnique({ where: { leadId }, select: SELECT });
    if (!existing) return { record: null, changed: false };

    // The database requires withdrawnAt >= recordedAt; never let a skewed clock make a valid withdrawal fail.
    const at = withdrawnAt.getTime() < existing.recordedAt.getTime() ? existing.recordedAt : withdrawnAt;
    const { count } = await prisma.leadContactSharingRecord.updateMany({
      where: { leadId, basis: "CONSENT", withdrawnAt: null },
      data: { withdrawnAt: at },
    });
    const row = await prisma.leadContactSharingRecord.findUniqueOrThrow({ where: { leadId }, select: SELECT });
    return { record: toRecord(row), changed: count === 1 };
  }

  async listByUser(userId: string, limit: number): Promise<LeadContactSharingRecordData[]> {
    const rows = await prisma.leadContactSharingRecord.findMany({
      where: { userId },
      orderBy: [{ recordedAt: "desc" }, { id: "desc" }],
      take: limit,
      select: SELECT,
    });
    return rows.map(toRecord);
  }
}
