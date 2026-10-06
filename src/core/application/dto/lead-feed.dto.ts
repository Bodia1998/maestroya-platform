import type { RequestUrgencyValue } from "@/domain/repositories/service-request-repository";
import type { LeadPublicationSnapshot } from "@/domain/services/lead-publication";

/**
 * Module 134 — Lead Feed v2 response shape. Built ONLY through
 * `toLeadFeedItemDto` (explicit whitelist), so an over-fetched source can never
 * leak contact data, coordinates, the owner's user id, payment/purchase data or
 * internal pricing mechanics.
 *
 * Price/currency/buyer policy come from the immutable Module 133 publication
 * snapshot, never from current pricing configuration.
 *
 * Deliberately NOT exposed (not clearly part of the product contract; see the
 * Module 134 report): estimated job value, pricing rate/confidence, rule and
 * configuration versions, buyer policy version. Whether the lead can still take
 * another buyer ("currently purchasable") is NOT computed by the feed; that is
 * enforced by the purchase lifecycle. `buyerPolicy.maxBuyers` is the published
 * limit, not remaining capacity.
 */
export interface LeadFeedItemSource {
  leadId: string;
  title: string;
  description: string;
  categoryId: string;
  categoryName: string;
  urgency: RequestUrgencyValue;
  city: string;
  province: string | null;
  distanceKm: number | null;
  publication: LeadPublicationSnapshot;
}

export interface LeadFeedItemDTO {
  leadId: string;
  title: string;
  description: string;
  categoryId: string;
  categoryName: string;
  urgency: RequestUrgencyValue;
  city: string;
  province: string | null;
  distanceKm: number | null;
  /** Snapshot lead-purchase price (decimal string, 2 decimals). */
  price: string;
  currency: string;
  buyerPolicy: { maxBuyers: number };
  publishedAt: Date;
}

export interface LeadFeedPageDTO {
  items: LeadFeedItemDTO[];
  /** Opaque; pass back unchanged to fetch the next page. null = end of feed. */
  nextCursor: string | null;
}

export function toLeadFeedItemDto(source: LeadFeedItemSource): LeadFeedItemDTO {
  return {
    leadId: source.leadId,
    title: source.title,
    description: source.description,
    categoryId: source.categoryId,
    categoryName: source.categoryName,
    urgency: source.urgency,
    city: source.city,
    province: source.province,
    distanceKm: source.distanceKm,
    price: source.publication.price,
    currency: source.publication.currency,
    buyerPolicy: { maxBuyers: source.publication.maxBuyers },
    publishedAt: source.publication.publishedAt,
  };
}
