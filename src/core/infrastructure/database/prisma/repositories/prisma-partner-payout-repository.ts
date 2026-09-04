import { Prisma } from "@prisma/client";

import { ConflictError } from "@/domain/errors/domain-error";
import { prisma } from "@/infrastructure/database/prisma/client";
import type {
  CreatePartnerPayoutData,
  PartnerPayoutRecord,
  PartnerPayoutRepository,
  PartnerPayoutStatusValue,
} from "@/domain/repositories/partner-payout-repository";
import type { PartnerPayoutMethodValue } from "@/domain/repositories/partner-repository";

/**
 * Module 61 — Affiliate & Partner System: Prisma implementation of
 * `PartnerPayoutRepository`, backed by the `partner_payouts` table.
 */
const PARTNER_PAYOUT_SELECT = {
  id: true,
  partnerId: true,
  amount: true,
  currency: true,
  method: true,
  status: true,
  reference: true,
  periodStart: true,
  periodEnd: true,
  processedAt: true,
  failureReason: true,
  createdAt: true,
  updatedAt: true,
} as const;

type PartnerPayoutRow = {
  id: string;
  partnerId: string;
  amount: { toNumber(): number };
  currency: string;
  method: string;
  status: string;
  reference: string | null;
  periodStart: Date;
  periodEnd: Date;
  processedAt: Date | null;
  failureReason: string | null;
  createdAt: Date;
  updatedAt: Date;
};

function toRecord(row: PartnerPayoutRow): PartnerPayoutRecord {
  return {
    id: row.id,
    partnerId: row.partnerId,
    amount: row.amount.toNumber(),
    currency: row.currency,
    method: row.method as PartnerPayoutMethodValue,
    status: row.status as PartnerPayoutStatusValue,
    reference: row.reference,
    periodStart: row.periodStart,
    periodEnd: row.periodEnd,
    processedAt: row.processedAt,
    failureReason: row.failureReason,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

export class PrismaPartnerPayoutRepository implements PartnerPayoutRepository {
  async create(data: CreatePartnerPayoutData): Promise<PartnerPayoutRecord> {
    const row = await prisma.partnerPayout.create({
      data: {
        partnerId: data.partnerId,
        amount: data.amount,
        currency: data.currency ?? "EUR",
        method: data.method,
        periodStart: data.periodStart,
        periodEnd: data.periodEnd,
      },
      select: PARTNER_PAYOUT_SELECT,
    });
    return toRecord(row);
  }

  async createBatch(data: CreatePartnerPayoutData, commissionIds: string[]): Promise<PartnerPayoutRecord> {
    try {
      const row = await prisma.$transaction(async (tx) => {
        const payout = await tx.partnerPayout.create({
          data: {
            partnerId: data.partnerId,
            amount: data.amount,
            currency: data.currency ?? "EUR",
            method: data.method,
            periodStart: data.periodStart,
            periodEnd: data.periodEnd,
          },
          select: PARTNER_PAYOUT_SELECT,
        });

        // Module 96 Financial Fix Pass — the atomic claim: only rows
        // still APPROVED and not already claimed by another payout are
        // affected. The row-count check below is what actually detects
        // a lost race against a concurrent payout attempt for one of the
        // same commissions (never possible in practice today, since this
        // whole batch was selected from one partner's own
        // `listApprovedForPartner` moments earlier — but this is the
        // real, DB-level guarantee, not an assumption about caller
        // behavior).
        const claimed = await tx.affiliateCommission.updateMany({
          where: { id: { in: commissionIds }, payoutId: null, status: "APPROVED" },
          data: { payoutId: payout.id },
        });

        if (claimed.count !== commissionIds.length) {
          throw new ConflictError(
            `Could not claim all ${commissionIds.length} commission(s) for this payout — ${claimed.count} were claimable. ` +
              `Another payout may already be in progress for one of them.`,
          );
        }

        return payout;
      });

      return toRecord(row);
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
        // Lost the race at the partial-unique-index level — another
        // in-flight (PENDING/PROCESSING) payout already exists for this
        // partner. Same ConflictError shape as the commission-claim
        // failure above, so the use case has one error type to handle.
        throw new ConflictError(`Partner "${data.partnerId}" already has a payout in progress.`);
      }
      throw error;
    }
  }

  async findById(id: string): Promise<PartnerPayoutRecord | null> {
    const row = await prisma.partnerPayout.findUnique({ where: { id }, select: PARTNER_PAYOUT_SELECT });
    return row ? toRecord(row) : null;
  }

  async listStuckProcessing(olderThan: Date, limit: number): Promise<PartnerPayoutRecord[]> {
    const rows = await prisma.partnerPayout.findMany({
      where: { status: "PROCESSING", updatedAt: { lt: olderThan } },
      orderBy: { updatedAt: "asc" },
      take: limit,
      select: PARTNER_PAYOUT_SELECT,
    });
    return rows.map(toRecord);
  }

  async listForPartner(partnerId: string): Promise<PartnerPayoutRecord[]> {
    const rows = await prisma.partnerPayout.findMany({
      where: { partnerId },
      orderBy: { createdAt: "desc" },
      select: PARTNER_PAYOUT_SELECT,
    });
    return rows.map(toRecord);
  }

  async updateStatus(
    id: string,
    data: { status: PartnerPayoutStatusValue; reference?: string | null; processedAt?: Date | null; failureReason?: string | null },
  ): Promise<PartnerPayoutRecord> {
    const row = await prisma.partnerPayout.update({
      where: { id },
      data: {
        status: data.status,
        reference: data.reference,
        processedAt: data.processedAt,
        failureReason: data.failureReason,
      },
      select: PARTNER_PAYOUT_SELECT,
    });
    return toRecord(row);
  }
}
