import { ValidationError } from "@/domain/errors/domain-error";
import type { LeadFeedCandidate, LeadFeedPosition, LeadFeedRepository } from "@/domain/repositories/lead-feed-repository";
import type { ProfessionalDiscoveryRepository } from "@/domain/repositories/professional-discovery-repository";
import type { ProfessionalRepository } from "@/domain/repositories/professional-repository";
import type { ServiceRequestStatusValue } from "@/domain/repositories/service-request-repository";
import { ServiceRequestNotEligibleForLeadError, assertServiceRequestEligibleForLead, type LeadStatus } from "@/domain/services/lead";
import { isLeadMarketplaceReady, isLeadPublicationSnapshotComplete } from "@/domain/services/lead-publication";
import { distanceToRequestKm, isProfessionalEligibleForRequest } from "@/domain/services/quote-eligibility";
import { toLeadFeedItemDto, type LeadFeedItemDTO, type LeadFeedPageDTO } from "@/application/dto/lead-feed.dto";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export const LEAD_FEED_DEFAULT_PAGE_SIZE = 20;
export const LEAD_FEED_MAX_PAGE_SIZE = 50;
/** Bounds the scan when the radius rule (applied in the application layer, as in Module 124) rejects many rows. */
export const LEAD_FEED_MAX_SCAN_BATCHES = 5;

export interface GetLeadFeedInput {
  limit?: number;
  /** Opaque cursor from a previous page's `nextCursor`. */
  cursor?: string | null;
  /** Optional filter; intersected with the professional's own categories. */
  categoryId?: string | null;
}

/** Opaque keyset cursor: base64url("<publishedAt ISO>|<leadId>"). Carries position only, never identity or authorization. */
export function encodeLeadFeedCursor(position: LeadFeedPosition): string {
  return Buffer.from(`${position.publishedAt.toISOString()}|${position.leadId}`, "utf8").toString("base64url");
}

export function decodeLeadFeedCursor(cursor: string): LeadFeedPosition {
  const invalid = () => new ValidationError("Invalid feed cursor.");
  if (typeof cursor !== "string" || cursor.length === 0 || cursor.length > 128) throw invalid();
  const [iso, leadId, ...rest] = Buffer.from(cursor, "base64url").toString("utf8").split("|");
  if (rest.length > 0 || !iso || !leadId || !UUID.test(leadId)) throw invalid();
  const publishedAt = new Date(iso);
  if (Number.isNaN(publishedAt.getTime()) || publishedAt.toISOString() !== iso) throw invalid();
  return { publishedAt, leadId };
}

/**
 * Module 134 — LEAD_V1 Lead Feed v2: the professional-facing marketplace
 * discovery read model.
 *
 * `userId` MUST come from the server-side session. Same identity and
 * eligibility conventions as the Module 124 preview: an ACTIVE
 * ProfessionalProfile resolved from the session user, the professional's own
 * categories, the existing radius rule, and never the professional's own
 * request. Anyone else gets an empty page (no signal about what exists).
 *
 * Eligibility is NOT redefined here: a candidate is returned only if the
 * authoritative Module 133 policy `isLeadMarketplaceReady` (which embeds the
 * Module 130 `isLeadAvailableForMarketplace`: LEAD_V1, PUBLISHED, open and
 * non-deleted request) accepts it together with its complete publication
 * snapshot. The repository's query-level narrowing is an efficiency filter;
 * this check is what decides. Rows with a missing or malformed snapshot are
 * silently skipped.
 *
 * The price shown is the immutable publication snapshot. The feed never
 * resolves pricing configuration, never estimates or prices, never creates or
 * reads purchases, never reserves a lead and never enforces the buyer limit
 * (purchase lifecycle). It exposes only the contact-safe LeadFeedItemDTO.
 *
 * Order: (publishedAt DESC, leadId DESC) — total and deterministic. Keyset
 * cursor pagination.
 */
export class GetLeadFeedForProfessionalUseCase {
  constructor(
    private readonly professionals: ProfessionalRepository,
    private readonly professionalDiscovery: ProfessionalDiscoveryRepository,
    private readonly feed: LeadFeedRepository,
  ) {}

  async execute(userId: string, input: GetLeadFeedInput = {}): Promise<LeadFeedPageDTO> {
    const limit = normalizeLimit(input.limit);
    const after = input.cursor ? decodeLeadFeedCursor(input.cursor) : null;
    const categoryFilter = input.categoryId ?? null;
    if (categoryFilter !== null && (typeof categoryFilter !== "string" || !UUID.test(categoryFilter))) {
      throw new ValidationError("Invalid category filter.");
    }

    const empty: LeadFeedPageDTO = { items: [], nextCursor: null };
    const professional = await this.professionals.findByUserId(userId);
    if (!professional) return empty;
    const candidate = await this.professionalDiscovery.findCandidateById(professional.id);
    if (!candidate || candidate.categoryIds.length === 0) return empty;

    const categoryIds = categoryFilter === null ? candidate.categoryIds : candidate.categoryIds.filter((id) => id === categoryFilter);
    if (categoryIds.length === 0) return empty;

    const batchSize = limit * 2 + 1;
    const collected: { dto: LeadFeedItemDTO; position: LeadFeedPosition }[] = [];
    let cursor = after;
    let exhausted = false;
    let lastScanned: LeadFeedPosition | null = after;

    for (let batch = 0; batch < LEAD_FEED_MAX_SCAN_BATCHES && collected.length <= limit; batch += 1) {
      const rows = await this.feed.findPage({ categoryIds, excludeCustomerUserId: userId, after: cursor, take: batchSize });
      for (const row of rows) {
        lastScanned = row.position;
        const dto = this.toItem(row, userId, candidate);
        if (dto) collected.push({ dto, position: row.position });
        if (collected.length > limit) break;
      }
      if (collected.length > limit) break;
      if (rows.length < batchSize) {
        exhausted = true;
        break;
      }
      cursor = rows[rows.length - 1]!.position;
    }

    if (collected.length > limit) {
      const page = collected.slice(0, limit);
      return { items: page.map((p) => p.dto), nextCursor: encodeLeadFeedCursor(page[limit - 1]!.position) };
    }
    // Scan budget hit before the end: more rows may exist beyond what was scanned.
    const nextCursor = exhausted || lastScanned === null ? null : encodeLeadFeedCursor(lastScanned);
    return { items: collected.map((p) => p.dto), nextCursor };
  }

  private toItem(row: LeadFeedCandidate, userId: string, professional: Parameters<typeof isProfessionalEligibleForRequest>[0]): LeadFeedItemDTO | null {
    if (row.customerUserId === userId) return null;
    const ready = isLeadMarketplaceReady({
      leadStatus: row.leadStatus as LeadStatus,
      flowVersion: row.flowVersion,
      requestStatus: row.requestStatus as ServiceRequestStatusValue,
      requestDeleted: row.requestDeleted,
      publication: row.publication,
    });
    if (!ready || !isLeadPublicationSnapshotComplete(row.publication)) return null;
    if (!isRequestComplete(row)) return null;
    if (!isProfessionalEligibleForRequest(professional, row)) return null;
    const distanceKm = distanceToRequestKm(professional, row);
    if (distanceKm === null) return null;
    return toLeadFeedItemDto({
      leadId: row.leadId,
      title: row.title,
      description: row.description,
      categoryId: row.categoryId,
      categoryName: row.categoryName,
      urgency: row.urgency,
      city: row.city,
      province: row.province,
      distanceKm: Math.round(distanceKm * 10) / 10,
      publication: row.publication,
    });
  }
}

/** Reuses the Module 124/130 request-completeness rule (title, description, city) instead of restating it. */
function isRequestComplete(row: LeadFeedCandidate): boolean {
  try {
    assertServiceRequestEligibleForLead({
      status: row.requestStatus as ServiceRequestStatusValue,
      title: row.title,
      description: row.description,
      location: { city: row.city },
    });
    return true;
  } catch (error) {
    if (error instanceof ServiceRequestNotEligibleForLeadError) return false;
    throw error;
  }
}

function normalizeLimit(limit: number | undefined): number {
  if (limit === undefined) return LEAD_FEED_DEFAULT_PAGE_SIZE;
  if (!Number.isInteger(limit) || limit < 1 || limit > LEAD_FEED_MAX_PAGE_SIZE) {
    throw new ValidationError(`Feed page size must be an integer between 1 and ${LEAD_FEED_MAX_PAGE_SIZE}.`);
  }
  return limit;
}
