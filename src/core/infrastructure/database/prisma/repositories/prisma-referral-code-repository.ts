import { prisma } from "@/infrastructure/database/prisma/client";
import type { CreateReferralCodeData, ReferralCodeRecord, ReferralCodeRepository } from "@/domain/repositories/referral-code-repository";

/**
 * Module 60 — Referral & Marketing Attribution Platform: Prisma
 * implementation of `ReferralCodeRepository`, backed by the
 * `referral_codes` table. Same "narrow SELECT + toRecord mapper"
 * convention as `PrismaProfessionalVerificationRepository`.
 */
const REFERRAL_CODE_SELECT = {
  id: true,
  code: true,
  ownerUserId: true,
  label: true,
  source: true,
  isActive: true,
  createdAt: true,
} as const;

type ReferralCodeRow = {
  id: string;
  code: string;
  ownerUserId: string | null;
  label: string | null;
  source: string | null;
  isActive: boolean;
  createdAt: Date;
};

function toReferralCodeRecord(row: ReferralCodeRow): ReferralCodeRecord {
  return {
    id: row.id,
    code: row.code,
    ownerUserId: row.ownerUserId,
    label: row.label,
    source: row.source,
    isActive: row.isActive,
    createdAt: row.createdAt,
  };
}

export class PrismaReferralCodeRepository implements ReferralCodeRepository {
  async create(data: CreateReferralCodeData): Promise<ReferralCodeRecord> {
    const row = await prisma.referralCode.create({
      data: {
        code: data.code,
        ownerUserId: data.ownerUserId ?? null,
        label: data.label ?? null,
        source: data.source ?? null,
      },
      select: REFERRAL_CODE_SELECT,
    });
    return toReferralCodeRecord(row);
  }

  async findByCode(code: string): Promise<ReferralCodeRecord | null> {
    const row = await prisma.referralCode.findUnique({ where: { code }, select: REFERRAL_CODE_SELECT });
    return row ? toReferralCodeRecord(row) : null;
  }

  async findById(id: string): Promise<ReferralCodeRecord | null> {
    const row = await prisma.referralCode.findUnique({ where: { id }, select: REFERRAL_CODE_SELECT });
    return row ? toReferralCodeRecord(row) : null;
  }

  async list(): Promise<ReferralCodeRecord[]> {
    const rows = await prisma.referralCode.findMany({ orderBy: { createdAt: "desc" }, select: REFERRAL_CODE_SELECT });
    return rows.map(toReferralCodeRecord);
  }

  async findByOwnerUserId(ownerUserId: string): Promise<ReferralCodeRecord[]> {
    const rows = await prisma.referralCode.findMany({
      where: { ownerUserId },
      orderBy: { createdAt: "desc" },
      select: REFERRAL_CODE_SELECT,
    });
    return rows.map(toReferralCodeRecord);
  }

  async setActive(id: string, isActive: boolean): Promise<void> {
    await prisma.referralCode.updateMany({ where: { id }, data: { isActive } });
  }
}
