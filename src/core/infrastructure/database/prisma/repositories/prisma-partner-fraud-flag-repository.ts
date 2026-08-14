import { prisma } from "@/infrastructure/database/prisma/client";
import type {
  CreatePartnerFraudFlagData,
  PartnerFraudFlagRecord,
  PartnerFraudFlagRepository,
  PartnerFraudFlagStatusValue,
  PartnerFraudFlagTypeValue,
} from "@/domain/repositories/partner-fraud-flag-repository";

/**
 * Module 61 — Affiliate & Partner System: Prisma implementation of
 * `PartnerFraudFlagRepository`, backed by the `partner_fraud_flags` table.
 */
const FRAUD_FLAG_SELECT = {
  id: true,
  partnerId: true,
  type: true,
  status: true,
  detail: true,
  relatedReferralCode: true,
  relatedVisitorId: true,
  relatedUserId: true,
  resolvedAt: true,
  resolvedByUserId: true,
  resolution: true,
  createdAt: true,
} as const;

type FraudFlagRow = {
  id: string;
  partnerId: string;
  type: string;
  status: string;
  detail: string;
  relatedReferralCode: string | null;
  relatedVisitorId: string | null;
  relatedUserId: string | null;
  resolvedAt: Date | null;
  resolvedByUserId: string | null;
  resolution: string | null;
  createdAt: Date;
};

function toRecord(row: FraudFlagRow): PartnerFraudFlagRecord {
  return {
    id: row.id,
    partnerId: row.partnerId,
    type: row.type as PartnerFraudFlagTypeValue,
    status: row.status as PartnerFraudFlagStatusValue,
    detail: row.detail,
    relatedReferralCode: row.relatedReferralCode,
    relatedVisitorId: row.relatedVisitorId,
    relatedUserId: row.relatedUserId,
    resolvedAt: row.resolvedAt,
    resolvedByUserId: row.resolvedByUserId,
    resolution: row.resolution,
    createdAt: row.createdAt,
  };
}

export class PrismaPartnerFraudFlagRepository implements PartnerFraudFlagRepository {
  async create(data: CreatePartnerFraudFlagData): Promise<PartnerFraudFlagRecord> {
    const row = await prisma.partnerFraudFlag.create({
      data: {
        partnerId: data.partnerId,
        type: data.type,
        detail: data.detail,
        relatedReferralCode: data.relatedReferralCode ?? null,
        relatedVisitorId: data.relatedVisitorId ?? null,
        relatedUserId: data.relatedUserId ?? null,
      },
      select: FRAUD_FLAG_SELECT,
    });
    return toRecord(row);
  }

  async listForPartner(partnerId: string): Promise<PartnerFraudFlagRecord[]> {
    const rows = await prisma.partnerFraudFlag.findMany({
      where: { partnerId },
      orderBy: { createdAt: "desc" },
      select: FRAUD_FLAG_SELECT,
    });
    return rows.map(toRecord);
  }

  async listOpen(): Promise<PartnerFraudFlagRecord[]> {
    const rows = await prisma.partnerFraudFlag.findMany({
      where: { status: "OPEN" },
      orderBy: { createdAt: "asc" },
      select: FRAUD_FLAG_SELECT,
    });
    return rows.map(toRecord);
  }

  async resolve(
    id: string,
    data: { status: "REVIEWED" | "DISMISSED" | "CONFIRMED"; resolvedByUserId: string; resolution: string },
  ): Promise<PartnerFraudFlagRecord> {
    const row = await prisma.partnerFraudFlag.update({
      where: { id },
      data: {
        status: data.status,
        resolvedAt: new Date(),
        resolvedByUserId: data.resolvedByUserId,
        resolution: data.resolution,
      },
      select: FRAUD_FLAG_SELECT,
    });
    return toRecord(row);
  }

  async countOpenForPartner(partnerId: string): Promise<number> {
    return prisma.partnerFraudFlag.count({ where: { partnerId, status: "OPEN" } });
  }
}
