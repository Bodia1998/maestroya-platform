import { prisma } from "@/infrastructure/database/prisma/client";
import type {
  TrustAutomatedActionRepository,
  TrustAutomatedActionRecord,
  CreateTrustAutomatedActionData,
  TrustAutomatedActionTypeValue,
  TrustAutomatedActionStatusValue,
} from "@/domain/repositories/trust-automated-action-repository";
import type { TrustRiskEventReasonValue } from "@/domain/services/trust-score-policy";

/** Module 65 — Trust & Integrity System: Prisma implementation backed by
 *  `trust_automated_actions`. */
function toRecord(row: {
  id: string;
  userId: string;
  type: string;
  status: string;
  reason: string;
  triggeringRiskScore: number;
  detail: string;
  createdByUserId: string | null;
  expiresAt: Date | null;
  reversedAt: Date | null;
  reversedByUserId: string | null;
  createdAt: Date;
  updatedAt: Date;
}): TrustAutomatedActionRecord {
  return {
    ...row,
    type: row.type as TrustAutomatedActionTypeValue,
    status: row.status as TrustAutomatedActionStatusValue,
    reason: row.reason as TrustRiskEventReasonValue,
  };
}

export class PrismaTrustAutomatedActionRepository implements TrustAutomatedActionRepository {
  async create(data: CreateTrustAutomatedActionData): Promise<TrustAutomatedActionRecord> {
    const row = await prisma.trustAutomatedAction.create({
      data: {
        userId: data.userId,
        type: data.type,
        reason: data.reason,
        triggeringRiskScore: data.triggeringRiskScore,
        detail: data.detail,
        createdByUserId: data.createdByUserId ?? null,
        expiresAt: data.expiresAt ?? null,
      },
    });
    return toRecord(row);
  }

  async findById(id: string): Promise<TrustAutomatedActionRecord | null> {
    const row = await prisma.trustAutomatedAction.findUnique({ where: { id } });
    return row ? toRecord(row) : null;
  }

  async listForUser(userId: string): Promise<TrustAutomatedActionRecord[]> {
    const rows = await prisma.trustAutomatedAction.findMany({ where: { userId }, orderBy: { createdAt: "desc" } });
    return rows.map(toRecord);
  }

  async listActiveForUser(userId: string, type?: TrustAutomatedActionTypeValue): Promise<TrustAutomatedActionRecord[]> {
    const rows = await prisma.trustAutomatedAction.findMany({
      where: { userId, status: "ACTIVE", ...(type ? { type } : {}) },
      orderBy: { createdAt: "desc" },
    });
    return rows.map(toRecord);
  }

  async countActiveForUser(userId: string): Promise<number> {
    return prisma.trustAutomatedAction.count({ where: { userId, status: "ACTIVE" } });
  }

  async reverse(id: string, reversedByUserId: string): Promise<TrustAutomatedActionRecord> {
    const row = await prisma.trustAutomatedAction.update({
      where: { id },
      data: { status: "REVERSED", reversedAt: new Date(), reversedByUserId },
    });
    return toRecord(row);
  }

  async expireDue(now: Date): Promise<number> {
    const result = await prisma.trustAutomatedAction.updateMany({
      where: { status: "ACTIVE", expiresAt: { not: null, lt: now } },
      data: { status: "EXPIRED" },
    });
    return result.count;
  }

  async countAll(): Promise<number> {
    return prisma.trustAutomatedAction.count();
  }

  async countByType(type: TrustAutomatedActionTypeValue): Promise<number> {
    return prisma.trustAutomatedAction.count({ where: { type } });
  }

  async countActive(): Promise<number> {
    return prisma.trustAutomatedAction.count({ where: { status: "ACTIVE" } });
  }
}
