import { prisma } from "@/infrastructure/database/prisma/client";
import type {
  TrustAppealRepository,
  TrustAppealRecord,
  CreateTrustAppealData,
} from "@/domain/repositories/trust-appeal-repository";
import type { AppealStateValue } from "@/domain/entities/appeal";

/** Module 65 — Trust & Integrity System: Prisma implementation backed by
 *  `trust_appeals`. */
function toRecord(row: {
  id: string;
  userId: string;
  automatedActionId: string;
  state: string;
  userStatement: string;
  reviewedAt: Date | null;
  reviewedByUserId: string | null;
  reviewNotes: string | null;
  restoredAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}): TrustAppealRecord {
  return { ...row, state: row.state as AppealStateValue };
}

const NON_TERMINAL_STATES: AppealStateValue[] = ["SUBMITTED", "UNDER_REVIEW"];

export class PrismaTrustAppealRepository implements TrustAppealRepository {
  async create(data: CreateTrustAppealData): Promise<TrustAppealRecord> {
    const row = await prisma.trustAppeal.create({ data });
    return toRecord(row);
  }

  async findById(id: string): Promise<TrustAppealRecord | null> {
    const row = await prisma.trustAppeal.findUnique({ where: { id } });
    return row ? toRecord(row) : null;
  }

  async listForUser(userId: string): Promise<TrustAppealRecord[]> {
    const rows = await prisma.trustAppeal.findMany({ where: { userId }, orderBy: { createdAt: "desc" } });
    return rows.map(toRecord);
  }

  async findOpenByAutomatedActionId(automatedActionId: string): Promise<TrustAppealRecord | null> {
    const row = await prisma.trustAppeal.findFirst({
      where: { automatedActionId, state: { in: NON_TERMINAL_STATES } },
      orderBy: { createdAt: "desc" },
    });
    return row ? toRecord(row) : null;
  }

  async listByState(state: AppealStateValue): Promise<TrustAppealRecord[]> {
    const rows = await prisma.trustAppeal.findMany({ where: { state }, orderBy: { createdAt: "asc" } });
    return rows.map(toRecord);
  }

  async transition(
    id: string,
    state: AppealStateValue,
    data?: { reviewedByUserId?: string; reviewNotes?: string; restoredAt?: Date },
  ): Promise<TrustAppealRecord> {
    const isReviewed = state === "APPROVED" || state === "REJECTED";
    const row = await prisma.trustAppeal.update({
      where: { id },
      data: {
        state,
        ...(isReviewed ? { reviewedAt: new Date() } : {}),
        ...(data?.reviewedByUserId ? { reviewedByUserId: data.reviewedByUserId } : {}),
        ...(data?.reviewNotes ? { reviewNotes: data.reviewNotes } : {}),
        ...(data?.restoredAt ? { restoredAt: data.restoredAt } : {}),
      },
    });
    return toRecord(row);
  }

  async countByState(state: AppealStateValue): Promise<number> {
    return prisma.trustAppeal.count({ where: { state } });
  }

  async countAll(): Promise<number> {
    return prisma.trustAppeal.count();
  }
}
