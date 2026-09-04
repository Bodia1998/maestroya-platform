import { Prisma } from "@prisma/client";

import { prisma } from "@/infrastructure/database/prisma/client";
import type {
  AffiliateCommissionReversalRecord,
  AffiliateCommissionReversalRepository,
  AffiliateCommissionReversalTypeValue,
  CreateAffiliateCommissionReversalData,
} from "@/domain/repositories/affiliate-commission-reversal-repository";

/**
 * Module 96 — Prisma implementation of
 * `AffiliateCommissionReversalRepository`, backed by the
 * `affiliate_commission_reversals` table.
 */
const SELECT = {
  id: true,
  affiliateCommissionId: true,
  amount: true,
  type: true,
  financialAdjustmentId: true,
  reason: true,
  createdAt: true,
} as const;

type Row = {
  id: string;
  affiliateCommissionId: string;
  amount: { toNumber(): number };
  type: string;
  financialAdjustmentId: string;
  reason: string | null;
  createdAt: Date;
};

function toRecord(row: Row): AffiliateCommissionReversalRecord {
  return {
    id: row.id,
    affiliateCommissionId: row.affiliateCommissionId,
    amount: row.amount.toNumber(),
    type: row.type as AffiliateCommissionReversalTypeValue,
    financialAdjustmentId: row.financialAdjustmentId,
    reason: row.reason,
    createdAt: row.createdAt,
  };
}

export class PrismaAffiliateCommissionReversalRepository implements AffiliateCommissionReversalRepository {
  async createIfNotExists(data: CreateAffiliateCommissionReversalData): Promise<AffiliateCommissionReversalRecord> {
    try {
      const row = await prisma.affiliateCommissionReversal.create({
        data: {
          affiliateCommissionId: data.affiliateCommissionId,
          amount: data.amount,
          type: data.type,
          financialAdjustmentId: data.financialAdjustmentId,
          reason: data.reason,
        },
        select: SELECT,
      });
      return toRecord(row);
    } catch (error) {
      // Lost a race with a concurrent/duplicate reversal attempt for the
      // exact same financialAdjustmentId — the unique constraint is the
      // authoritative guarantee (see repository interface's own doc
      // comment); converge on the winning row instead of failing.
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
        const existing = await this.findByFinancialAdjustmentId(data.financialAdjustmentId);
        if (existing) return existing;
      }
      throw error;
    }
  }

  async findByFinancialAdjustmentId(financialAdjustmentId: string): Promise<AffiliateCommissionReversalRecord | null> {
    const row = await prisma.affiliateCommissionReversal.findUnique({ where: { financialAdjustmentId }, select: SELECT });
    return row ? toRecord(row) : null;
  }

  async listForAffiliateCommission(affiliateCommissionId: string): Promise<AffiliateCommissionReversalRecord[]> {
    const rows = await prisma.affiliateCommissionReversal.findMany({
      where: { affiliateCommissionId },
      orderBy: { createdAt: "asc" },
      select: SELECT,
    });
    return rows.map(toRecord);
  }

  async sumForAffiliateCommission(affiliateCommissionId: string): Promise<number> {
    const result = await prisma.affiliateCommissionReversal.aggregate({
      where: { affiliateCommissionId },
      _sum: { amount: true },
    });
    return result._sum.amount ? result._sum.amount.toNumber() : 0;
  }
}
