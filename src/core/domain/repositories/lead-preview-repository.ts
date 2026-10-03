import type { RequestUrgencyValue } from "@/domain/repositories/service-request-repository";

/**
 * Module 124 — read port for the professional-facing Lead Marketplace feed.
 * Deliberately separate from `LeadRepository` (write/identity side) and from
 * `ServiceRequestDiscoveryRepository` (the LEGACY quote feed, which must
 * never serve LEAD_V1 requests).
 *
 * Only PUBLISHED leads whose ServiceRequest is LEAD_V1, still open
 * (PUBLISHED) and not soft-deleted are ever returned — filtered at query
 * level, never left to the caller.
 *
 * SECURITY: a candidate holds the safe preview fields plus two INTERNAL
 * values the use case needs (coordinates for the radius rule, the owner's
 * user id to exclude a professional's own request). Both are stripped by
 * `toLeadPreviewDto` and must never reach a response. No street address, no
 * contact columns, no LeadPurchase data are selectable through this port.
 */
export interface LeadPreviewCandidate {
  leadId: string;
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
  createdAt: Date;
}

export interface LeadPreviewRepository {
  /** A single visible (PUBLISHED, LEAD_V1, open request) lead, else null. */
  findPublishedById(leadId: string): Promise<LeadPreviewCandidate | null>;
  /** All visible leads whose request is in one of the given categories. */
  findPublishedByCategoryIds(categoryIds: string[]): Promise<LeadPreviewCandidate[]>;
}
