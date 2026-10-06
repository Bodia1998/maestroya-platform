import type { RequestUrgencyValue } from "@/domain/repositories/service-request-repository";

/**
 * Module 134 — read port for the LEAD_V1 Lead Feed v2 (professional-facing
 * marketplace discovery). Separate from `LeadRepository` (write/identity side),
 * from `LeadPreviewRepository` (Module 124 single-lead/legacy-visibility read)
 * and from `ServiceRequestDiscoveryRepository` (the LEGACY quote feed).
 *
 * The repository narrows the scan at query level (LEAD_V1, PUBLISHED, open and
 * non-deleted request, snapshot columns present, category, own-request
 * exclusion, keyset position) so the feed never loads every lead. It does NOT
 * decide marketplace readiness: each candidate carries the raw inputs the
 * authoritative Module 130/133 policy (`isLeadMarketplaceReady`) needs, and the
 * use case applies that policy. No second definition of "available" lives here.
 *
 * SECURITY: coordinates and the owner's user id are INTERNAL (radius rule and
 * own-request exclusion) and are stripped by `toLeadFeedItemDto`. No street
 * address, postal code, contact column or LeadPurchase data is selectable
 * through this port.
 */

/** Total-order key of the feed: publication time, then lead id (both DESC). */
export interface LeadFeedPosition {
  publishedAt: Date;
  leadId: string;
}

export interface LeadFeedCandidate {
  leadId: string;
  /** Position of this row in the feed ordering (cursor source). */
  position: LeadFeedPosition;

  /** Raw inputs of the Module 130/133 readiness policy. */
  leadStatus: string;
  flowVersion: string;
  requestStatus: string;
  requestDeleted: boolean;
  /** Stored publication snapshot as read (decimal strings), or null when absent/incomplete. Validated by the domain policy, never trusted here. */
  publication: unknown;

  title: string;
  description: string;
  categoryId: string;
  categoryName: string;
  urgency: RequestUrgencyValue;
  /** Coarse location only (city/province). */
  city: string;
  province: string | null;
  /** INTERNAL: radius rule only, never exposed. */
  latitude: number | null;
  longitude: number | null;
  /** INTERNAL: own-request exclusion only, never exposed. */
  customerUserId: string;
}

export interface LeadFeedPageQuery {
  /** Only requests in these categories (must be non-empty). */
  categoryIds: string[];
  /** Never return this user's own requests. */
  excludeCustomerUserId: string;
  /** Exclusive upper bound in (publishedAt DESC, leadId DESC) order; null = first page. */
  after: LeadFeedPosition | null;
  take: number;
}

export interface LeadFeedRepository {
  /** Up to `take` candidates ordered by (publishedAt DESC, leadId DESC) strictly after `after`. */
  findPage(query: LeadFeedPageQuery): Promise<LeadFeedCandidate[]>;
}
