import { prisma } from "@/infrastructure/database/prisma/client";
import type {
  CreateReferralVisitData,
  ReferralVisitRecord,
  ReferralVisitRepository,
  TopCampaignStat,
  TopReferralCodeStat,
} from "@/domain/repositories/referral-visit-repository";
import type { MarketingSourceValue } from "@/domain/services/marketing-source-rules";

/**
 * Module 60 — Referral & Marketing Attribution Platform: Prisma
 * implementation of `ReferralVisitRepository`, backed by the
 * `referral_visits` table.
 */
const REFERRAL_VISIT_SELECT = {
  id: true,
  visitorId: true,
  referralCode: true,
  utmSource: true,
  utmMedium: true,
  utmCampaign: true,
  utmContent: true,
  utmTerm: true,
  marketingSource: true,
  ipHash: true,
  userAgentTruncated: true,
  landingPage: true,
  createdAt: true,
} as const;

type ReferralVisitRow = {
  id: string;
  visitorId: string;
  referralCode: string | null;
  utmSource: string | null;
  utmMedium: string | null;
  utmCampaign: string | null;
  utmContent: string | null;
  utmTerm: string | null;
  marketingSource: string;
  ipHash: string | null;
  userAgentTruncated: string | null;
  landingPage: string;
  createdAt: Date;
};

function toReferralVisitRecord(row: ReferralVisitRow): ReferralVisitRecord {
  return {
    id: row.id,
    visitorId: row.visitorId,
    referralCode: row.referralCode,
    utmSource: row.utmSource,
    utmMedium: row.utmMedium,
    utmCampaign: row.utmCampaign,
    utmContent: row.utmContent,
    utmTerm: row.utmTerm,
    marketingSource: row.marketingSource as MarketingSourceValue,
    ipHash: row.ipHash,
    userAgentTruncated: row.userAgentTruncated,
    landingPage: row.landingPage,
    createdAt: row.createdAt,
  };
}

export class PrismaReferralVisitRepository implements ReferralVisitRepository {
  async create(data: CreateReferralVisitData): Promise<ReferralVisitRecord> {
    const row = await prisma.referralVisit.create({
      data: {
        visitorId: data.visitorId,
        referralCode: data.referralCode,
        utmSource: data.utmSource,
        utmMedium: data.utmMedium,
        utmCampaign: data.utmCampaign,
        utmContent: data.utmContent,
        utmTerm: data.utmTerm,
        marketingSource: data.marketingSource,
        ipHash: data.ipHash,
        userAgentTruncated: data.userAgentTruncated,
        landingPage: data.landingPage,
      },
      select: REFERRAL_VISIT_SELECT,
    });
    return toReferralVisitRecord(row);
  }

  async findRecentByVisitor(visitorId: string, since: Date): Promise<ReferralVisitRecord[]> {
    const rows = await prisma.referralVisit.findMany({
      where: { visitorId, createdAt: { gte: since } },
      select: REFERRAL_VISIT_SELECT,
    });
    return rows.map(toReferralVisitRecord);
  }

  async countAll(): Promise<number> {
    return prisma.referralVisit.count();
  }

  async topReferralCodesByVisits(limit: number): Promise<TopReferralCodeStat[]> {
    const grouped = await prisma.referralVisit.groupBy({
      by: ["referralCode"],
      where: { referralCode: { not: null } },
      _count: { _all: true },
      orderBy: { _count: { referralCode: "desc" } },
      take: limit,
    });
    return grouped
      .filter((g): g is typeof g & { referralCode: string } => g.referralCode !== null)
      .map((g) => ({ referralCode: g.referralCode, visits: g._count._all }));
  }

  async topCampaignsByVisits(limit: number): Promise<TopCampaignStat[]> {
    const grouped = await prisma.referralVisit.groupBy({
      by: ["utmCampaign"],
      where: { utmCampaign: { not: null } },
      _count: { _all: true },
      orderBy: { _count: { utmCampaign: "desc" } },
      take: limit,
    });
    return grouped
      .filter((g): g is typeof g & { utmCampaign: string } => g.utmCampaign !== null)
      .map((g) => ({ campaign: g.utmCampaign, visits: g._count._all }));
  }
}
