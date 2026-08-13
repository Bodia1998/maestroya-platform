import { prisma } from "@/infrastructure/database/prisma/client";
import type {
  ConversionEventRecord,
  ConversionEventRepository,
  ConversionTypeValue,
  RecordConversionEventData,
} from "@/domain/repositories/conversion-event-repository";

/**
 * Module 60 — Referral & Marketing Attribution Platform: Prisma
 * implementation of `ConversionEventRepository`, backed by the
 * `conversion_events` table. `revenueAmount` is stored as Prisma's
 * `Decimal` and converted to/from `number` here — the same "Decimal at
 * the Prisma boundary, plain number in the domain/application layers"
 * convention `money.ts`-adjacent modules already use.
 */
const CONVERSION_EVENT_SELECT = {
  id: true,
  attributionId: true,
  type: true,
  occurredAt: true,
  referenceId: true,
  revenueAmount: true,
  createdAt: true,
} as const;

type ConversionEventRow = {
  id: string;
  attributionId: string;
  type: string;
  occurredAt: Date;
  referenceId: string | null;
  revenueAmount: { toNumber(): number } | null;
  createdAt: Date;
};

function toConversionEventRecord(row: ConversionEventRow): ConversionEventRecord {
  return {
    id: row.id,
    attributionId: row.attributionId,
    type: row.type as ConversionTypeValue,
    occurredAt: row.occurredAt,
    referenceId: row.referenceId,
    revenueAmount: row.revenueAmount ? row.revenueAmount.toNumber() : null,
    createdAt: row.createdAt,
  };
}

export class PrismaConversionEventRepository implements ConversionEventRepository {
  async create(data: RecordConversionEventData): Promise<ConversionEventRecord> {
    const row = await prisma.conversionEvent.create({
      data: {
        attributionId: data.attributionId,
        type: data.type,
        occurredAt: data.occurredAt,
        referenceId: data.referenceId ?? null,
        revenueAmount: data.revenueAmount ?? null,
      },
      select: CONVERSION_EVENT_SELECT,
    });
    return toConversionEventRecord(row);
  }

  async listByAttributionId(attributionId: string): Promise<ConversionEventRecord[]> {
    const rows = await prisma.conversionEvent.findMany({
      where: { attributionId },
      orderBy: { occurredAt: "asc" },
      select: CONVERSION_EVENT_SELECT,
    });
    return rows.map(toConversionEventRecord);
  }

  async countByType(type: ConversionTypeValue): Promise<number> {
    return prisma.conversionEvent.count({ where: { type } });
  }

  async sumRevenueByType(type: ConversionTypeValue): Promise<number> {
    const result = await prisma.conversionEvent.aggregate({
      where: { type },
      _sum: { revenueAmount: true },
    });
    return result._sum.revenueAmount ? result._sum.revenueAmount.toNumber() : 0;
  }
}
