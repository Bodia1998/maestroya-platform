import { Prisma } from "@prisma/client";

import { prisma } from "@/infrastructure/database/prisma/client";
import type {
  CreateLeadPurchaseData,
  InitiateLeadPurchaseData,
  LeadPurchasePaymentCorrelationReader,
  LeadPurchaseRecord,
  LeadPurchaseRepository,
} from "@/domain/repositories/lead-purchase-repository";
import { formatScaledDecimal, parseScaledDecimal } from "@/domain/services/fixed-point-decimal";
import { toLeadPurchaseFinancialSnapshot } from "@/domain/services/lead-purchase-financial-snapshot";
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
  pricingConfigVersion: true,
  pricingRuleVersion: true,
  leadPublishedAt: true,
  taxAmount: true,
  totalAmount: true,
  taxPolicyVersion: true,
  paymentReference: true,
  confirmedAt: true,
  failedAt: true,
  cancelledAt: true,
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
  pricingConfigVersion: string | null;
  pricingRuleVersion: string | null;
  leadPublishedAt: Date | null;
  taxAmount: unknown;
  totalAmount: unknown;
  taxPolicyVersion: string | null;
  paymentReference: string | null;
  confirmedAt: Date | null;
  failedAt: Date | null;
  cancelledAt: Date | null;
  refundedAt: Date | null;
  revokedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
};

/** Exact Decimal(10,2) -> normalised decimal string via the shared fixed-point parser (no floating point). */
function exactMoney(value: unknown, column: string): string {
  const parsed = parseScaledDecimal(String(value), 2);
  if (parsed === null) throw new Error(`LeadPurchase ${column} is not a valid Decimal(10,2).`);
  return formatScaledDecimal(parsed, 2, 2);
}

function toRecord(row: Row): LeadPurchaseRecord {
  if (!isLeadPurchaseStatus(row.status)) throw new Error(`Unknown LeadPurchase status "${row.status}".`);
  return {
    id: row.id,
    leadId: row.leadId,
    professionalProfileId: row.professionalProfileId,
    status: row.status,
    price: Number(row.price),
    currency: row.currency,
    financialSnapshot: {
      feeAmount: exactMoney(row.price, "price"),
      currency: row.currency,
      taxAmount: row.taxAmount === null || row.taxAmount === undefined ? null : exactMoney(row.taxAmount, "taxAmount"),
      totalAmount: row.totalAmount === null || row.totalAmount === undefined ? null : exactMoney(row.totalAmount, "totalAmount"),
      taxPolicyVersion: row.taxPolicyVersion ?? null,
      pricingConfigVersion: row.pricingConfigVersion ?? null,
      pricingRuleVersion: row.pricingRuleVersion ?? null,
      leadPublishedAt: row.leadPublishedAt ?? null,
    },
    paymentReference: row.paymentReference ?? null,
    confirmedAt: row.confirmedAt,
    failedAt: row.failedAt,
    cancelledAt: row.cancelledAt,
    refundedAt: row.refundedAt,
    revokedAt: row.revokedAt,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

/** The lead columns `initiate` reads under the row lock. Numerics are cast to text so they are never converted through a JS number. */
interface LockedLeadRow {
  status: string;
  maxBuyers: number | null;
  publishedAt: Date | null;
  publicationPrice: string | null;
  publicationCurrency: string | null;
  publicationEstimatedJobValue: string | null;
  publicationPricingRate: string | null;
  publicationPricingConfidence: string | null;
  publicationPricingConfigVersion: string | null;
  publicationJobValueRuleVersion: string | null;
  publicationPricingRuleVersion: string | null;
  publicationBuyerPolicyVersion: string | null;
}

/** Locked-row -> the snapshot a purchase is created from, or null when the Lead has no complete, valid M133 snapshot. */
function financialSnapshotFromLockedLead(lead: LockedLeadRow) {
  const normalise = (raw: string | null, scale: number): string | null => {
    const parsed = raw === null ? null : parseScaledDecimal(raw, scale);
    return parsed === null ? null : formatScaledDecimal(parsed, scale, 2);
  };
  try {
    return toLeadPurchaseFinancialSnapshot({
      price: normalise(lead.publicationPrice, 2),
      currency: lead.publicationCurrency,
      estimatedJobValue: normalise(lead.publicationEstimatedJobValue, 2),
      pricingRate: normalise(lead.publicationPricingRate, 6),
      pricingConfidence: lead.publicationPricingConfidence,
      pricingConfigVersion: lead.publicationPricingConfigVersion,
      jobValueRuleVersion: lead.publicationJobValueRuleVersion,
      pricingRuleVersion: lead.publicationPricingRuleVersion,
      buyerPolicyVersion: lead.publicationBuyerPolicyVersion,
      maxBuyers: lead.maxBuyers,
      publishedAt: lead.publishedAt,
    });
  } catch {
    return null;
  }
}

/** Module 123 — Prisma implementation of `LeadPurchaseRepository`. Touches
 *  only the `lead_purchases` table: it never creates a Payment, Commission,
 *  Payout or Invoice. */
export class PrismaLeadPurchaseRepository implements LeadPurchaseRepository, LeadPurchasePaymentCorrelationReader {
  async initiate(data: InitiateLeadPurchaseData): Promise<LeadPurchaseRecord> {
    try {
      const row = await prisma.$transaction(async (tx) => {
        // Row lock on the lead: EVERY concurrent buyer of the SAME lead queues here, so
        // duplicate-check -> count -> insert below cannot interleave (same professional
        // retrying, or different professionals racing for the last slot).
        const locked = await tx.$queryRaw<LockedLeadRow[]>`
          SELECT "status"::text AS "status", "maxBuyers", "publishedAt",
                 "publicationPrice"::text AS "publicationPrice",
                 "publicationCurrency",
                 "publicationEstimatedJobValue"::text AS "publicationEstimatedJobValue",
                 "publicationPricingRate"::text AS "publicationPricingRate",
                 "publicationPricingConfidence",
                 "publicationPricingConfigVersion",
                 "publicationJobValueRuleVersion",
                 "publicationPricingRuleVersion",
                 "publicationBuyerPolicyVersion"
          FROM "leads" WHERE "id" = ${data.leadId}::uuid FOR UPDATE`;
        const lead = locked[0];
        if (!lead || lead.status !== "PUBLISHED") throw new LeadNotPurchasableError();
        // Module 135: the fee is the Lead's immutable publication snapshot, read under the same
        // lock. A Lead without a complete snapshot (e.g. a pre-M133 publication) is never purchasable.
        const snapshot = financialSnapshotFromLockedLead(lead);
        if (!snapshot) throw new LeadNotPurchasableError();

        // Idempotency boundary: one active purchase per (lead, professional). Checked under the
        // lead lock and BEFORE capacity, so the buyer's own retry is "duplicate", never "limit reached".
        const own = await tx.leadPurchase.count({
          where: {
            leadId: data.leadId,
            professionalProfileId: data.professionalProfileId,
            status: { in: [...ACTIVE_LEAD_PURCHASE_STATUSES] },
          },
        });
        if (own > 0) throw new DuplicateActiveLeadPurchaseError();

        const active = await tx.leadPurchase.count({
          where: { leadId: data.leadId, status: { in: [...ACTIVE_LEAD_PURCHASE_STATUSES] } },
        });
        if (!hasBuyerCapacity(lead.maxBuyers, active)) throw new LeadBuyerLimitReachedError();

        return tx.leadPurchase.create({
          data: {
            leadId: data.leadId,
            professionalProfileId: data.professionalProfileId,
            // Decimal strings: money never passes through a JS number on the write path.
            price: snapshot.feeAmount,
            currency: snapshot.currency,
            pricingConfigVersion: snapshot.pricingConfigVersion,
            pricingRuleVersion: snapshot.pricingRuleVersion,
            leadPublishedAt: snapshot.leadPublishedAt,
            // Module 136: IVA computed by the pure policy from the immutable fee, persisted atomically with it.
            taxAmount: snapshot.taxAmount,
            totalAmount: snapshot.totalAmount,
            taxPolicyVersion: snapshot.taxPolicyVersion,
          },
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

  async recordPaymentReference(id: string, paymentReference: string): Promise<LeadPurchaseRecord | null> {
    // Conditional write: only a still-PENDING_PAYMENT purchase with no reference yet is updated,
    // exactly once. Touches no financial column and never the status.
    const { count } = await prisma.leadPurchase.updateMany({
      where: { id, status: "PENDING_PAYMENT", paymentReference: null },
      data: { paymentReference },
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

  async findByPaymentReference(paymentReference: string): Promise<LeadPurchaseRecord | null> {
    if (typeof paymentReference !== "string" || paymentReference === "") return null;
    const row = await prisma.leadPurchase.findUnique({ where: { paymentReference }, select: SELECT });
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
