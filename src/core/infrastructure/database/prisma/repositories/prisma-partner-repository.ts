import type { Prisma } from "@prisma/client";

import { prisma } from "@/infrastructure/database/prisma/client";
import type {
  CreatePartnerData,
  PartnerPayoutDetails,
  PartnerPayoutMethodValue,
  PartnerRecord,
  PartnerRepository,
  PartnerStatusValue,
  PartnerTypeValue,
  UpdatePartnerStatusData,
} from "@/domain/repositories/partner-repository";

/**
 * Module 61 — Affiliate & Partner System: Prisma implementation of
 * `PartnerRepository`, backed by the `partners` table. Same "narrow SELECT
 * + toRecord mapper" convention as `PrismaReferralCodeRepository`.
 */
const PARTNER_SELECT = {
  id: true,
  userId: true,
  type: true,
  status: true,
  displayName: true,
  contactEmail: true,
  payoutMethod: true,
  payoutDetails: true,
  minimumPayoutThreshold: true,
  notes: true,
  approvedAt: true,
  approvedByUserId: true,
  rejectedAt: true,
  rejectedReason: true,
  suspendedAt: true,
  suspendedReason: true,
  bannedAt: true,
  bannedReason: true,
  createdAt: true,
  updatedAt: true,
} as const;

type PartnerRow = {
  id: string;
  userId: string;
  type: string;
  status: string;
  displayName: string;
  contactEmail: string;
  payoutMethod: string;
  payoutDetails: unknown;
  minimumPayoutThreshold: { toNumber(): number };
  notes: string | null;
  approvedAt: Date | null;
  approvedByUserId: string | null;
  rejectedAt: Date | null;
  rejectedReason: string | null;
  suspendedAt: Date | null;
  suspendedReason: string | null;
  bannedAt: Date | null;
  bannedReason: string | null;
  createdAt: Date;
  updatedAt: Date;
};

function toPartnerRecord(row: PartnerRow): PartnerRecord {
  return {
    id: row.id,
    userId: row.userId,
    type: row.type as PartnerTypeValue,
    status: row.status as PartnerStatusValue,
    displayName: row.displayName,
    contactEmail: row.contactEmail,
    payoutMethod: row.payoutMethod as PartnerPayoutMethodValue,
    payoutDetails: (row.payoutDetails as PartnerPayoutDetails | null) ?? null,
    minimumPayoutThreshold: row.minimumPayoutThreshold.toNumber(),
    notes: row.notes,
    approvedAt: row.approvedAt,
    approvedByUserId: row.approvedByUserId,
    rejectedAt: row.rejectedAt,
    rejectedReason: row.rejectedReason,
    suspendedAt: row.suspendedAt,
    suspendedReason: row.suspendedReason,
    bannedAt: row.bannedAt,
    bannedReason: row.bannedReason,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

export class PrismaPartnerRepository implements PartnerRepository {
  async create(data: CreatePartnerData): Promise<PartnerRecord> {
    const row = await prisma.partner.create({
      data: {
        userId: data.userId,
        type: data.type,
        displayName: data.displayName,
        contactEmail: data.contactEmail,
        payoutMethod: data.payoutMethod ?? "MANUAL",
        payoutDetails: (data.payoutDetails ?? undefined) as Prisma.InputJsonValue | undefined,
        minimumPayoutThreshold: data.minimumPayoutThreshold,
      },
      select: PARTNER_SELECT,
    });
    return toPartnerRecord(row);
  }

  async findById(id: string): Promise<PartnerRecord | null> {
    const row = await prisma.partner.findUnique({ where: { id }, select: PARTNER_SELECT });
    return row ? toPartnerRecord(row) : null;
  }

  async findByUserId(userId: string): Promise<PartnerRecord | null> {
    const row = await prisma.partner.findUnique({ where: { userId }, select: PARTNER_SELECT });
    return row ? toPartnerRecord(row) : null;
  }

  async updateStatus(id: string, data: UpdatePartnerStatusData): Promise<PartnerRecord> {
    const row = await prisma.partner.update({
      where: { id },
      data: {
        status: data.status,
        approvedAt: data.approvedAt,
        approvedByUserId: data.approvedByUserId,
        rejectedAt: data.rejectedAt,
        rejectedReason: data.rejectedReason,
        suspendedAt: data.suspendedAt,
        suspendedReason: data.suspendedReason,
        bannedAt: data.bannedAt,
        bannedReason: data.bannedReason,
      },
      select: PARTNER_SELECT,
    });
    return toPartnerRecord(row);
  }

  async list(filter?: { status?: PartnerStatusValue }): Promise<PartnerRecord[]> {
    const rows = await prisma.partner.findMany({
      where: filter?.status ? { status: filter.status } : undefined,
      orderBy: { createdAt: "desc" },
      select: PARTNER_SELECT,
    });
    return rows.map(toPartnerRecord);
  }

  async countByStatus(status: PartnerStatusValue): Promise<number> {
    return prisma.partner.count({ where: { status } });
  }
}
