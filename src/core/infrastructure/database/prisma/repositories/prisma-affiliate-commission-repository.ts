import { prisma } from "@/infrastructure/database/prisma/client";
import type {
  AffiliateCommissionRecord,
  AffiliateCommissionRepository,
  AffiliateCommissionStatusValue,
  AffiliateEarningsTotals,
  CreateAffiliateCommissionData,
} from "@/domain/repositories/affiliate-commission-repository";

/**
 * Module 61 — Affiliate & Partner System: Prisma implementation of
 * `AffiliateCommissionRepository`, backed by the `affiliate_commissions`
 * table. `platformCommissionAmount`/`affiliateAmount` are stored as
 * Prisma's `Decimal` and converted to/from `number` here — same convention
 * `PrismaConversionEventRepository` uses for `revenueAmount`.
 */
const AFFILIATE_COMMISSION_SELECT = {
  id: true,
  partnerId: true,
  referralCode: true,
  conversionEventId: true,
  platformCommissionRefId: true,
  platformCommissionAmount: true,
  affiliateRateBps: true,
  affiliateAmount: true,
  status: true,
  approvedAt: true,
  cancelledAt: true,
  cancelReason: true,
  expiresAt: true,
  expiredAt: true,
  paidAt: true,
  payoutId: true,
  createdAt: true,
  updatedAt: true,
} as const;

type AffiliateCommissionRow = {
  id: string;
  partnerId: string;
  referralCode: string;
  conversionEventId: string;
  platformCommissionRefId: string;
  platformCommissionAmount: { toNumber(): number };
  affiliateRateBps: number;
  affiliateAmount: { toNumber(): number };
  status: string;
  approvedAt: Date | null;
  cancelledAt: Date | null;
  cancelReason: string | null;
  expiresAt: Date;
  expiredAt: Date | null;
  paidAt: Date | null;
  payoutId: string | null;
  createdAt: Date;
  updatedAt: Date;
};

function toRecord(row: AffiliateCommissionRow): AffiliateCommissionRecord {
  return {
    id: row.id,
    partnerId: row.partnerId,
    referralCode: row.referralCode,
    conversionEventId: row.conversionEventId,
    platformCommissionRefId: row.platformCommissionRefId,
    platformCommissionAmount: row.platformCommissionAmount.toNumber(),
    affiliateRateBps: row.affiliateRateBps,
    affiliateAmount: row.affiliateAmount.toNumber(),
    status: row.status as AffiliateCommissionStatusValue,
    approvedAt: row.approvedAt,
    cancelledAt: row.cancelledAt,
    cancelReason: row.cancelReason,
    expiresAt: row.expiresAt,
    expiredAt: row.expiredAt,
    paidAt: row.paidAt,
    payoutId: row.payoutId,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

export class PrismaAffiliateCommissionRepository implements AffiliateCommissionRepository {
  async create(data: CreateAffiliateCommissionData): Promise<AffiliateCommissionRecord> {
    const row = await prisma.affiliateCommission.create({
      data: {
        partnerId: data.partnerId,
        referralCode: data.referralCode,
        conversionEventId: data.conversionEventId,
        platformCommissionRefId: data.platformCommissionRefId,
        platformCommissionAmount: data.platformCommissionAmount,
        affiliateRateBps: data.affiliateRateBps,
        affiliateAmount: data.affiliateAmount,
        expiresAt: data.expiresAt,
      },
      select: AFFILIATE_COMMISSION_SELECT,
    });
    return toRecord(row);
  }

  async findById(id: string): Promise<AffiliateCommissionRecord | null> {
    const row = await prisma.affiliateCommission.findUnique({ where: { id }, select: AFFILIATE_COMMISSION_SELECT });
    return row ? toRecord(row) : null;
  }

  async findByConversionEventId(conversionEventId: string): Promise<AffiliateCommissionRecord | null> {
    const row = await prisma.affiliateCommission.findUnique({ where: { conversionEventId }, select: AFFILIATE_COMMISSION_SELECT });
    return row ? toRecord(row) : null;
  }

  async listForPartner(partnerId: string, filter?: { status?: AffiliateCommissionStatusValue }): Promise<AffiliateCommissionRecord[]> {
    const rows = await prisma.affiliateCommission.findMany({
      where: { partnerId, status: filter?.status },
      orderBy: { createdAt: "desc" },
      select: AFFILIATE_COMMISSION_SELECT,
    });
    return rows.map(toRecord);
  }

  async listExpirable(asOf: Date): Promise<AffiliateCommissionRecord[]> {
    const rows = await prisma.affiliateCommission.findMany({
      where: { status: "PENDING", expiresAt: { lte: asOf } },
      select: AFFILIATE_COMMISSION_SELECT,
    });
    return rows.map(toRecord);
  }

  async listApprovedForPartner(partnerId: string): Promise<AffiliateCommissionRecord[]> {
    const rows = await prisma.affiliateCommission.findMany({
      where: { partnerId, status: "APPROVED" },
      orderBy: { createdAt: "asc" },
      select: AFFILIATE_COMMISSION_SELECT,
    });
    return rows.map(toRecord);
  }

  async updateStatus(
    id: string,
    data: {
      status: AffiliateCommissionStatusValue;
      approvedAt?: Date | null;
      cancelledAt?: Date | null;
      cancelReason?: string | null;
      expiredAt?: Date | null;
      paidAt?: Date | null;
      payoutId?: string | null;
    },
  ): Promise<AffiliateCommissionRecord> {
    const row = await prisma.affiliateCommission.update({
      where: { id },
      data: {
        status: data.status,
        approvedAt: data.approvedAt,
        cancelledAt: data.cancelledAt,
        cancelReason: data.cancelReason,
        expiredAt: data.expiredAt,
        paidAt: data.paidAt,
        payoutId: data.payoutId,
      },
      select: AFFILIATE_COMMISSION_SELECT,
    });
    return toRecord(row);
  }

  async markPaidByIds(ids: string[], payoutId: string, paidAt: Date): Promise<void> {
    if (ids.length === 0) return;
    await prisma.affiliateCommission.updateMany({
      where: { id: { in: ids } },
      data: { status: "PAID", payoutId, paidAt },
    });
  }

  async totalsForPartner(partnerId: string): Promise<AffiliateEarningsTotals> {
    const [pending, approved, paid] = await Promise.all([
      prisma.affiliateCommission.aggregate({ where: { partnerId, status: "PENDING" }, _sum: { affiliateAmount: true } }),
      prisma.affiliateCommission.aggregate({ where: { partnerId, status: "APPROVED" }, _sum: { affiliateAmount: true } }),
      prisma.affiliateCommission.aggregate({ where: { partnerId, status: "PAID" }, _sum: { affiliateAmount: true } }),
    ]);
    return {
      pendingTotal: pending._sum.affiliateAmount?.toNumber() ?? 0,
      approvedTotal: approved._sum.affiliateAmount?.toNumber() ?? 0,
      paidTotal: paid._sum.affiliateAmount?.toNumber() ?? 0,
    };
  }
}
