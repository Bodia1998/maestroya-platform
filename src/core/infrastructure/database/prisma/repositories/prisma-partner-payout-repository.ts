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

  async findById(id: string): Promise<PartnerPayoutRecord | null> {
    const row = await prisma.partnerPayout.findUnique({ where: { id }, select: PARTNER_PAYOUT_SELECT });
    return row ? toRecord(row) : null;
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
