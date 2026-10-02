import { Prisma } from "@prisma/client";

import { prisma } from "@/infrastructure/database/prisma/client";
import type {
  CreateLeadPurchaseData,
  LeadPurchaseRecord,
  LeadPurchaseRepository,
} from "@/domain/repositories/lead-purchase-repository";
import {
  ACTIVE_LEAD_PURCHASE_STATUSES,
  DuplicateActiveLeadPurchaseError,
  LEAD_PURCHASE_CURRENCY,
  assertValidLeadPurchaseAmount,
  isLeadPurchaseStatus,
} from "@/domain/services/lead-purchase";

const SELECT = {
  id: true,
  leadId: true,
  professionalProfileId: true,
  status: true,
  price: true,
  currency: true,
  confirmedAt: true,
  refundedAt: true,
  revokedAt: true,
  createdAt: true,
  updatedAt: true,
} as const;

type Row = {
  id: string;
  leadId: string;
  professionalProfileId: string;
  status: string;
  price: unknown;
  currency: string;
  confirmedAt: Date | null;
  refundedAt: Date | null;
  revokedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
};

function toRecord(row: Row): LeadPurchaseRecord {
  if (!isLeadPurchaseStatus(row.status)) throw new Error(`Unknown LeadPurchase status "${row.status}".`);
  return {
    id: row.id,
    leadId: row.leadId,
    professionalProfileId: row.professionalProfileId,
    status: row.status,
    price: Number(row.price),
    currency: row.currency,
    confirmedAt: row.confirmedAt,
    refundedAt: row.refundedAt,
    revokedAt: row.revokedAt,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

/** Module 123 — Prisma implementation of `LeadPurchaseRepository`. Touches
 *  only the `lead_purchases` table: it never creates a Payment, Commission,
 *  Payout or Invoice. */
export class PrismaLeadPurchaseRepository implements LeadPurchaseRepository {
  async create(data: CreateLeadPurchaseData): Promise<LeadPurchaseRecord> {
    const currency = data.currency ?? LEAD_PURCHASE_CURRENCY;
    assertValidLeadPurchaseAmount(data.price, currency);
    try {
      const row = await prisma.leadPurchase.create({
        data: {
          leadId: data.leadId,
          professionalProfileId: data.professionalProfileId,
          price: data.price,
          currency,
        },
        select: SELECT,
      });
      return toRecord(row);
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
        throw new DuplicateActiveLeadPurchaseError();
      }
      throw error;
    }
  }

  async findById(id: string): Promise<LeadPurchaseRecord | null> {
    const row = await prisma.leadPurchase.findUnique({ where: { id }, select: SELECT });
    return row ? toRecord(row) : null;
  }

  async findActiveByLeadAndProfessional(leadId: string, professionalProfileId: string): Promise<LeadPurchaseRecord | null> {
    const row = await prisma.leadPurchase.findFirst({
      where: { leadId, professionalProfileId, status: { in: [...ACTIVE_LEAD_PURCHASE_STATUSES] } },
      orderBy: { createdAt: "desc" },
      select: SELECT,
    });
    return row ? toRecord(row) : null;
  }

  async findConfirmedByLeadAndProfessional(leadId: string, professionalProfileId: string): Promise<LeadPurchaseRecord | null> {
    const row = await prisma.leadPurchase.findFirst({
      where: { leadId, professionalProfileId, status: "CONFIRMED" },
      orderBy: { createdAt: "desc" },
      select: SELECT,
    });
    return row ? toRecord(row) : null;
  }
}
