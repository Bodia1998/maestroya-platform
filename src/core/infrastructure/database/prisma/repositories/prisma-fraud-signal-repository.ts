import { prisma } from "@/infrastructure/database/prisma/client";
import type {
  FraudSignalRepository,
  FraudSignalRecord,
  CreateFraudSignalData,
  FraudSignalType,
  FraudSignalStatusValue,
} from "@/domain/repositories/fraud-signal-repository";

/** Module 65 — Trust & Integrity System: Prisma implementation backed by
 *  `fraud_signals` — mirrors `PrismaPartnerFraudFlagRepository`'s own
 *  shape (Module 61), generalized from partners to any user. */
function toRecord(row: {
  id: string;
  userId: string;
  type: string;
  status: string;
  detail: string;
  relatedUserIds: string[];
  resolvedAt: Date | null;
  resolvedByUserId: string | null;
  resolution: string | null;
  createdAt: Date;
}): FraudSignalRecord {
  return { ...row, type: row.type as FraudSignalType, status: row.status as FraudSignalStatusValue };
}

export class PrismaFraudSignalRepository implements FraudSignalRepository {
  async create(data: CreateFraudSignalData): Promise<FraudSignalRecord> {
    const row = await prisma.fraudSignal.create({
      data: {
        userId: data.userId,
        type: data.type,
        detail: data.detail,
        relatedUserIds: data.relatedUserIds ?? [],
      },
    });
    return toRecord(row);
  }

  async listForUser(userId: string): Promise<FraudSignalRecord[]> {
    const rows = await prisma.fraudSignal.findMany({ where: { userId }, orderBy: { createdAt: "desc" } });
    return rows.map(toRecord);
  }

  async listOpen(): Promise<FraudSignalRecord[]> {
    const rows = await prisma.fraudSignal.findMany({ where: { status: "OPEN" }, orderBy: { createdAt: "asc" } });
    return rows.map(toRecord);
  }

  async resolve(
    id: string,
    data: { status: "REVIEWED" | "DISMISSED" | "CONFIRMED"; resolvedByUserId: string; resolution: string },
  ): Promise<FraudSignalRecord> {
    const row = await prisma.fraudSignal.update({
      where: { id },
      data: {
        status: data.status,
        resolvedAt: new Date(),
        resolvedByUserId: data.resolvedByUserId,
        resolution: data.resolution,
      },
    });
    return toRecord(row);
  }

  async countOpenForUser(userId: string): Promise<number> {
    return prisma.fraudSignal.count({ where: { userId, status: "OPEN" } });
  }

  async countAll(): Promise<number> {
    return prisma.fraudSignal.count();
  }

  async countByType(type: FraudSignalType): Promise<number> {
    return prisma.fraudSignal.count({ where: { type } });
  }
}
