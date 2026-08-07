import type { SearchDocument, SearchDocumentKind } from "@/domain/entities/search-document";
import type { CompanyDiscoveryRepository } from "@/domain/repositories/company-discovery-repository";
import type { ProfessionalDiscoveryRepository } from "@/domain/repositories/professional-discovery-repository";
import type { ServiceRequestRepository } from "@/domain/repositories/service-request-repository";
import { EXPIRABLE_SERVICE_REQUEST_STATUSES } from "@/domain/services/service-request-expiration-rules";
import {
  toCompanySearchDocument,
  toProfessionalSearchDocument,
  toServiceRequestSearchDocument,
} from "@/application/services/search/search-document-mapper";

/**
 * Module 47 — CQRS Search Engine (Roadmap Module 14).
 *
 * Reads one entity from the **write model** and returns its read-model
 * projection, or `null` when that entity should not be in the index at
 * all. Every indexing path — single document, batch, and full rebuild —
 * goes through this one class, so "what belongs in the index" is decided
 * in exactly one place.
 *
 * ## `null` is the whole design
 * Callers never have to ask "was this professional deactivated? did this
 * request get cancelled? was this company deleted?" — they ask for a
 * projection and get either a document (index it) or `null` (remove it).
 * That collapses four distinct sync problems (create, update, become
 * ineligible, hard-delete) into one code path, and means a *stale*
 * document can never survive an update: the same job that would refresh
 * it removes it instead the moment the entity stops qualifying.
 *
 * Eligibility itself is never re-derived here. Professionals and
 * companies are eligible exactly when the Module 19 discovery
 * repositories return them (ACTIVE, non-deleted — enforced at the query
 * level); service requests are eligible exactly while they are in the
 * open states `EXPIRABLE_SERVICE_REQUEST_STATUSES` already names
 * (PUBLISHED/QUOTED — "a professional could still act on this"). Reusing
 * both rules rather than restating them is what keeps the read model from
 * drifting away from what the rest of the platform considers visible.
 */
export interface SearchDocumentSources {
  professionals: ProfessionalDiscoveryRepository;
  companies: CompanyDiscoveryRepository;
  serviceRequests: ServiceRequestRepository;
}

export class SearchDocumentProjector {
  constructor(
    private readonly sources: SearchDocumentSources,
    /** Injected for deterministic `indexedAt` values in tests. */
    private readonly now: () => Date = () => new Date(),
  ) {}

  async project(kind: SearchDocumentKind, entityId: string): Promise<SearchDocument | null> {
    const indexedAt = this.now();

    switch (kind) {
      case "PROFESSIONAL": {
        const candidate = await this.sources.professionals.findCandidateById(entityId);
        return candidate ? toProfessionalSearchDocument(candidate, indexedAt) : null;
      }
      case "COMPANY": {
        const candidate = await this.sources.companies.findCandidateById(entityId);
        return candidate ? toCompanySearchDocument(candidate, indexedAt) : null;
      }
      case "SERVICE_REQUEST": {
        const request = await this.sources.serviceRequests.findById(entityId);
        if (!request) return null;
        if (!EXPIRABLE_SERVICE_REQUEST_STATUSES.includes(request.status)) return null;
        return toServiceRequestSearchDocument(request, indexedAt);
      }
    }
  }

  /**
   * Projects many entities of one kind, preserving input order and
   * dropping the ones that are no longer eligible. Returns both halves —
   * callers need the ineligible ids to *remove* them, not just the
   * documents to write.
   *
   * Reads are issued one at a time rather than with `Promise.all`:
   * batches here are sized by the caller (rebuild uses hundreds), and
   * fanning a whole batch out concurrently would put an unbounded burst
   * on the same Postgres pool serving live traffic — the opposite of what
   * a background reindex should do.
   */
  async projectMany(
    kind: SearchDocumentKind,
    entityIds: string[],
  ): Promise<{ documents: SearchDocument[]; missingIds: string[] }> {
    const documents: SearchDocument[] = [];
    const missingIds: string[] = [];

    for (const entityId of entityIds) {
      const document = await this.project(kind, entityId);
      if (document) documents.push(document);
      else missingIds.push(entityId);
    }

    return { documents, missingIds };
  }
}
