import { NotFoundError } from "@/domain/errors/domain-error";
import type { LeadPreviewCandidate, LeadPreviewRepository } from "@/domain/repositories/lead-preview-repository";
import type { ProfessionalDiscoveryRepository } from "@/domain/repositories/professional-discovery-repository";
import type { ProfessionalRepository } from "@/domain/repositories/professional-repository";
import { distanceToRequestKm, isProfessionalEligibleForRequest } from "@/domain/services/quote-eligibility";
import { toLeadPreviewDto, type LeadPreviewDTO } from "@/application/dto/lead-contact.dto";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Module 124 — professional-facing Lead Marketplace discovery. Its own read
 * path (LeadPreviewRepository); the legacy quote feed is untouched and still
 * excludes LEAD_V1.
 *
 * `userId` must come from the server-side session. Same identity and
 * eligibility conventions as the legacy feed: an ACTIVE ProfessionalProfile
 * (resolved through the discovery repository), the professional's own
 * categories, the existing radius rule, and never the professional's own
 * request. Anyone else gets an empty list / the same NotFoundError — no
 * signal about whether a lead exists or was bought by someone else.
 *
 * Output is built ONLY through `toLeadPreviewDto` (explicit whitelist), so
 * coordinates and the owner's user id used internally can never escape.
 * Preview is not contact access: GetLeadContactUseCase (Module 122) remains
 * the only contact path.
 */
export class GetPublishedLeadPreviewsForProfessionalUseCase {
  constructor(
    private readonly professionals: ProfessionalRepository,
    private readonly professionalDiscovery: ProfessionalDiscoveryRepository,
    private readonly leadPreviews: LeadPreviewRepository,
  ) {}

  async execute(userId: string): Promise<LeadPreviewDTO[]> {
    const professional = await this.professionals.findByUserId(userId);
    if (!professional) return [];

    const candidate = await this.professionalDiscovery.findCandidateById(professional.id);
    if (!candidate || candidate.categoryIds.length === 0) return [];

    const leads = await this.leadPreviews.findPublishedByCategoryIds(candidate.categoryIds);

    const results: LeadPreviewDTO[] = [];
    for (const lead of leads) {
      if (lead.customerUserId === userId) continue;
      if (!isProfessionalEligibleForRequest(candidate, lead)) continue;
      const distanceKm = distanceToRequestKm(candidate, lead);
      if (distanceKm === null) continue;
      results.push(toLeadPreviewDto({ ...pickPreviewSource(lead), distanceKm: Math.round(distanceKm * 10) / 10 }));
    }

    results.sort((a, b) => (a.distanceKm ?? 0) - (b.distanceKm ?? 0));
    return results;
  }
}

/** A single visible lead, subject to the same eligibility as the list. */
export class GetPublishedLeadPreviewUseCase {
  constructor(
    private readonly professionals: ProfessionalRepository,
    private readonly professionalDiscovery: ProfessionalDiscoveryRepository,
    private readonly leadPreviews: LeadPreviewRepository,
  ) {}

  async execute(userId: string, leadId: string): Promise<LeadPreviewDTO> {
    const notFound = () => new NotFoundError("Lead", String(leadId));
    if (typeof leadId !== "string" || !UUID.test(leadId)) throw notFound();

    const professional = await this.professionals.findByUserId(userId);
    if (!professional) throw notFound();
    const candidate = await this.professionalDiscovery.findCandidateById(professional.id);
    if (!candidate) throw notFound();

    const lead = await this.leadPreviews.findPublishedById(leadId);
    if (!lead || lead.customerUserId === userId) throw notFound();
    if (!isProfessionalEligibleForRequest(candidate, lead)) throw notFound();

    const distanceKm = distanceToRequestKm(candidate, lead);
    return toLeadPreviewDto({
      ...pickPreviewSource(lead),
      distanceKm: distanceKm === null ? null : Math.round(distanceKm * 10) / 10,
    });
  }
}

/** Explicit pick (no spread of the candidate): lat/lng and customerUserId are
 *  deliberately left behind. */
function pickPreviewSource(lead: LeadPreviewCandidate) {
  return {
    leadId: lead.leadId,
    title: lead.title,
    description: lead.description,
    categoryId: lead.categoryId,
    categoryName: lead.categoryName,
    urgency: lead.urgency,
    city: lead.city,
    province: lead.province,
    createdAt: lead.createdAt,
  };
}
