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
  LeadBuyerLimitReachedError,
  LeadNotPurchasableError,
  assertLeadPurchaseTransition,
  assertValidLeadPurchaseAmount,
  hasBuyerCapacity,
  isLeadPurchaseStatus,
  leadPurchaseTransitionTimestamp,
  type LeadPurchaseStatus,
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
  async initiate(data: CreateLeadPurchaseData): Promise<LeadPurchaseRecord> {
    const currency = data.currency ?? LEAD_PURCHASE_CURRENCY;
    assertValidLeadPurchaseAmount(data.price, currency);
    try {
      const row = await prisma.$transaction(async (tx) => {
        // Row lock on the lead: concurrent buyers of the SAME lead queue here,
        // so count -> insert below cannot interleave and exceed maxBuyers.
        const locked = await tx.$queryRaw<Array<{ status: string; maxBuyers: number | null }>>`
          SELECT "status"::text AS "status", "maxBuyers" FROM "leads" WHERE "id" = ${data.leadId}::uuid FOR UPDATE`;
        const lead = locked[0];
        if (!lead || lead.status !== "PUBLISHED") throw new LeadNotPurchasableError();

        const active = await tx.leadPurchase.count({
          where: { leadId: data.leadId, status: { in: [...ACTIVE_LEAD_PURCHASE_STATUSES] } },
        });
        if (!hasBuyerCapacity(lead.maxBuyers, active)) throw new LeadBuyerLimitReachedError();

        return tx.leadPurchase.create({
          data: { leadId: data.leadId, professionalProfileId: data.professionalProfileId, price: data.price, currency },
          select: SELECT,
        });
      });
      return toRecord(row);
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
        throw new DuplicateActiveLeadPurchaseError();
      }
      throw error;
    }
  }

  async transition(id: string, from: LeadPurchaseStatus, to: LeadPurchaseStatus, now: Date): Promise<LeadPurchaseRecord | null> {
    assertLeadPurchaseTransition(from, to);
    const stamp = leadPurchaseTransitionTimestamp(to);
    // Status-conditional write: only a row still in `from` moves, exactly once.
    const { count } = await prisma.leadPurchase.updateMany({
      where: { id, status: from },
      data: { status: to, ...(stamp ? { [stamp]: now } : {}) },
    });
    if (count === 0) return null;
    return this.findById(id);
  }

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
