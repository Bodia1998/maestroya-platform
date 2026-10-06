import { prisma } from "@/infrastructure/database/prisma/client";
import type { LeadFeedCandidate, LeadFeedPageQuery, LeadFeedRepository } from "@/domain/repositories/lead-feed-repository";
import { formatScaledDecimal, parseScaledDecimal } from "@/domain/services/fixed-point-decimal";
import { LEAD_ELIGIBLE_REQUEST_STATUS, LEAD_FLOW_VERSION } from "@/domain/services/lead";

/**
 * Module 134 — Prisma implementation of the Lead Feed v2 read path.
 *
 * Explicit select ONLY. Never add the street address, postal code,
 * customer/user contact columns or `purchases` here: the feed is not contact
 * access (Module 122's GetLeadContactUseCase is the only contact path) and
 * reads no purchase data. `address` is selected for city/province/coordinates
 * only; `customer` for `userId` only (own-request exclusion).
 *
 * The query narrows to LEAD_V1 + PUBLISHED lead + open, non-deleted request +
 * all snapshot columns present, ordered by (publishedAt DESC, id DESC) with a
 * keyset position. That is an efficiency filter only: the authoritative
 * readiness decision (`isLeadMarketplaceReady`) is applied by the use case on
 * the returned inputs. Snapshot values are read through their exact decimal
 * strings (never JS numbers) and are NOT validated here; a malformed snapshot
 * simply fails the domain policy.
 */
const SELECT = {
  id: true,
  status: true,
  maxBuyers: true,
  publishedAt: true,
  publicationPrice: true,
  publicationCurrency: true,
  publicationEstimatedJobValue: true,
  publicationPricingRate: true,
  publicationPricingConfidence: true,
  publicationPricingConfigVersion: true,
  publicationJobValueRuleVersion: true,
  publicationPricingRuleVersion: true,
  publicationBuyerPolicyVersion: true,
  serviceRequest: {
    select: {
      title: true,
      description: true,
      categoryId: true,
      urgency: true,
      flowVersion: true,
      status: true,
      deletedAt: true,
      category: { select: { name: true } },
      address: { select: { city: true, province: true, latitude: true, longitude: true } },
      customer: { select: { userId: true } },
    },
  },
} as const;

type DecimalLike = { toString(): string };

type Row = {
  id: string;
  status: string;
  maxBuyers: number | null;
  publishedAt: Date | null;
  publicationPrice: DecimalLike | null;
  publicationCurrency: string | null;
  publicationEstimatedJobValue: DecimalLike | null;
  publicationPricingRate: DecimalLike | null;
  publicationPricingConfidence: string | null;
  publicationPricingConfigVersion: string | null;
  publicationJobValueRuleVersion: string | null;
  publicationPricingRuleVersion: string | null;
  publicationBuyerPolicyVersion: string | null;
  serviceRequest: {
    title: string;
    description: string;
    categoryId: string;
    urgency: string;
    flowVersion: string;
    status: string;
    deletedAt: Date | null;
    category: { name: string };
    address: { city: string; province: string | null; latitude: number | null; longitude: number | null };
    customer: { userId: string };
  };
};

/** Exact Decimal -> normalised decimal string; an unparsable value is passed on verbatim so the domain policy rejects it. */
function decimalString(value: DecimalLike | null, scale: number): string | null {
  if (value === null) return null;
  const raw = value.toString();
  const parsed = parseScaledDecimal(raw, scale);
  return parsed === null ? raw : formatScaledDecimal(parsed, scale, 2);
}

function toPublication(row: Row): unknown {
  return {
    price: decimalString(row.publicationPrice, 2),
    currency: row.publicationCurrency,
    estimatedJobValue: decimalString(row.publicationEstimatedJobValue, 2),
    pricingRate: decimalString(row.publicationPricingRate, 6),
    pricingConfidence: row.publicationPricingConfidence,
    pricingConfigVersion: row.publicationPricingConfigVersion,
    jobValueRuleVersion: row.publicationJobValueRuleVersion,
    pricingRuleVersion: row.publicationPricingRuleVersion,
    buyerPolicyVersion: row.publicationBuyerPolicyVersion,
    maxBuyers: row.maxBuyers,
    publishedAt: row.publishedAt,
  };
}

function toCandidate(row: Row): LeadFeedCandidate {
  const request = row.serviceRequest;
  return {
    leadId: row.id,
    // The query guarantees publishedAt IS NOT NULL.
    position: { publishedAt: row.publishedAt as Date, leadId: row.id },
    leadStatus: row.status,
    flowVersion: request.flowVersion,
    requestStatus: request.status,
    requestDeleted: request.deletedAt !== null,
    publication: toPublication(row),
    title: request.title,
    description: request.description,
    categoryId: request.categoryId,
    categoryName: request.category.name,
    urgency: request.urgency as LeadFeedCandidate["urgency"],
    city: request.address.city,
    province: request.address.province,
    latitude: request.address.latitude,
    longitude: request.address.longitude,
    customerUserId: request.customer.userId,
  };
}

export class PrismaLeadFeedRepository implements LeadFeedRepository {
  async findPage(query: LeadFeedPageQuery): Promise<LeadFeedCandidate[]> {
    if (query.categoryIds.length === 0 || query.take < 1) return [];
    const rows = await prisma.lead.findMany({
      where: {
        status: "PUBLISHED",
        publishedAt: { not: null },
        publicationPrice: { not: null },
        publicationCurrency: { not: null },
        publicationEstimatedJobValue: { not: null },
        publicationPricingRate: { not: null },
        publicationPricingConfidence: { not: null },
        publicationPricingConfigVersion: { not: null },
        publicationJobValueRuleVersion: { not: null },
        publicationPricingRuleVersion: { not: null },
        publicationBuyerPolicyVersion: { not: null },
        maxBuyers: { not: null },
        serviceRequest: {
          flowVersion: LEAD_FLOW_VERSION,
          status: LEAD_ELIGIBLE_REQUEST_STATUS,
          deletedAt: null,
          categoryId: { in: query.categoryIds },
          customer: { userId: { not: query.excludeCustomerUserId } },
        },
        ...(query.after
          ? {
              OR: [
                { publishedAt: { lt: query.after.publishedAt } },
                { publishedAt: query.after.publishedAt, id: { lt: query.after.leadId } },
              ],
            }
          : {}),
      },
      select: SELECT,
      orderBy: [{ publishedAt: "desc" }, { id: "desc" }],
      take: query.take,
    });
    return rows.map(toCandidate);
  }
}
