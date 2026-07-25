import { prisma } from "@/infrastructure/database/prisma/client";
import type {
  CreateDisputeMessageData,
  DisputeMessageRecord,
  DisputeMessageRepository,
} from "@/domain/repositories/dispute-message-repository";

const SELECT = {
  id: true,
  disputeId: true,
  authorUserId: true,
  body: true,
  isInternalNote: true,
  createdAt: true,
} as const;

type Row = {
  id: string;
  disputeId: string;
  authorUserId: string;
  body: string;
  isInternalNote: boolean;
  createdAt: Date;
};

function toRecord(row: Row): DisputeMessageRecord {
  return { ...row };
}

/**
 * Module 21 — Disputes & Support: Prisma implementation of
 * DisputeMessageRepository. `listPublic` filters `isInternalNote: false` at
 * the query level (never in application code after the fact) — the same
 * "filter where the data is fetched" convention as
 * PrismaReviewRepository's PUBLIC_STATUS filter — so an internal note can
 * never accidentally leak through a code path that forgets to filter it
 * out client-side.
 */
export class PrismaDisputeMessageRepository implements DisputeMessageRepository {
  async create(data: CreateDisputeMessageData): Promise<DisputeMessageRecord> {
    const row = await prisma.disputeMessage.create({
      data: {
        disputeId: data.disputeId,
        authorUserId: data.authorUserId,
        body: data.body,
        isInternalNote: data.isInternalNote,
      },
      select: SELECT,
    });
    return toRecord(row);
  }

  async listPublic(disputeId: string): Promise<DisputeMessageRecord[]> {
    const rows = await prisma.disputeMessage.findMany({
      where: { disputeId, isInternalNote: false },
      select: SELECT,
      orderBy: [{ createdAt: "asc" }],
    });
    return rows.map(toRecord);
  }

  async listAll(disputeId: string): Promise<DisputeMessageRecord[]> {
    const rows = await prisma.disputeMessage.findMany({
      where: { disputeId },
      select: SELECT,
      orderBy: [{ createdAt: "asc" }],
    });
    return rows.map(toRecord);
  }
}
