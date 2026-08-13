import { prisma } from "@/infrastructure/database/prisma/client";
import type { MarketingAttributionRecord, MarketingAttributionRepository } from "@/domain/repositories/marketing-attribution-repository";
import type { AttributionTouchState } from "@/domain/services/marketing-attribution-touch-rules";
import type { MarketingSourceValue } from "@/domain/services/marketing-source-rules";

/**
 * Module 60 — Referral & Marketing Attribution Platform: Prisma
 * implementation of `MarketingAttributionRepository`, backed by the
 * `marketing_attributions` table (one row per `visitorId`, unique).
 */
const ATTRIBUTION_SELECT = {
  id: true,
  visitorId: true,
  firstSource: true,
  firstCampaign: true,
  firstReferralCode: true,
  firstVisitAt: true,
  lastSource: true,
  lastCampaign: true,
  lastReferralCode: true,
  lastVisitAt: true,
  userId: true,
  createdAt: true,
  updatedAt: true,
} as const;

type AttributionRow = {
  id: string;
  visitorId: string;
  firstSource: string | null;
  firstCampaign: string | null;
  firstReferralCode: string | null;
  firstVisitAt: Date | null;
  lastSource: string | null;
  lastCampaign: string | null;
  lastReferralCode: string | null;
  lastVisitAt: Date | null;
  userId: string | null;
  createdAt: Date;
  updatedAt: Date;
};

function toAttributionRecord(row: AttributionRow): MarketingAttributionRecord {
  return {
    id: row.id,
    visitorId: row.visitorId,
    firstSource: row.firstSource as MarketingSourceValue | null,
    firstCampaign: row.firstCampaign,
    firstReferralCode: row.firstReferralCode,
    firstVisitAt: row.firstVisitAt,
    lastSource: row.lastSource as MarketingSourceValue | null,
    lastCampaign: row.lastCampaign,
    lastReferralCode: row.lastReferralCode,
    lastVisitAt: row.lastVisitAt,
    userId: row.userId,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

export class PrismaMarketingAttributionRepository implements MarketingAttributionRepository {
  async findByVisitorId(visitorId: string): Promise<MarketingAttributionRecord | null> {
    const row = await prisma.marketingAttribution.findUnique({ where: { visitorId }, select: ATTRIBUTION_SELECT });
    return row ? toAttributionRecord(row) : null;
  }

  async upsertTouchState(visitorId: string, state: AttributionTouchState): Promise<MarketingAttributionRecord> {
    // `firstVisitAt` is required (NOT NULL) at the schema level — the
    // caller (TrackVisitUseCase) always supplies a real touch when calling
    // this for a create, so `state.firstVisitAt` is only null in the
    // defensive "no visit yet" fallback path, which this repository
    // should never actually be asked to persist as-is. Guard defensively
    // rather than writing an invalid row.
    const firstVisitAt = state.firstVisitAt ?? new Date();
    const lastVisitAt = state.lastVisitAt ?? firstVisitAt;

    const row = await prisma.marketingAttribution.upsert({
      where: { visitorId },
      create: {
        visitorId,
        firstSource: state.firstSource ?? "UNKNOWN",
        firstCampaign: state.firstCampaign,
        firstReferralCode: state.firstReferralCode,
        firstVisitAt,
        lastSource: state.lastSource ?? state.firstSource ?? "UNKNOWN",
        lastCampaign: state.lastCampaign ?? state.firstCampaign,
        lastReferralCode: state.lastReferralCode ?? state.firstReferralCode,
        lastVisitAt,
      },
      update: {
        // First-touch fields are intentionally included here too — they
        // are always the *unchanged* values `applyAttributionTouch`
        // already computed (it never mutates an already-set first touch),
        // so re-writing them is a no-op in practice, not a second place
        // where the immutability rule could be violated.
        firstSource: state.firstSource ?? "UNKNOWN",
        firstCampaign: state.firstCampaign,
        firstReferralCode: state.firstReferralCode,
        firstVisitAt,
        lastSource: state.lastSource ?? "UNKNOWN",
        lastCampaign: state.lastCampaign,
        lastReferralCode: state.lastReferralCode,
        lastVisitAt,
      },
      select: ATTRIBUTION_SELECT,
    });
    return toAttributionRecord(row);
  }

  async linkUser(visitorId: string, userId: string): Promise<void> {
    const existing = await prisma.marketingAttribution.findUnique({ where: { visitorId }, select: { id: true, userId: true } });
    if (!existing || existing.userId) return;
    await prisma.marketingAttribution.update({ where: { visitorId }, data: { userId } });
  }

  async countTotal(): Promise<number> {
    return prisma.marketingAttribution.count();
  }

  async countWithUser(): Promise<number> {
    return prisma.marketingAttribution.count({ where: { userId: { not: null } } });
  }
}
