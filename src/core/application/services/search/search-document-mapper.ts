import type { SearchDocument } from "@/domain/entities/search-document";
import { buildSearchDocumentId } from "@/domain/entities/search-document";
import type { ProfessionalDiscoveryCandidate } from "@/domain/repositories/professional-discovery-repository";
import type { CompanyDiscoveryCandidate } from "@/domain/repositories/company-discovery-repository";
import type { ServiceRequestRecord } from "@/domain/repositories/service-request-repository";

/**
 * Module 47 — CQRS Search Engine (Roadmap Module 14).
 *
 * The **projection** half of CQRS: pure functions that turn a write-model
 * record into the read model's `SearchDocument`. This is the only place
 * that knowledge lives, so "what is searchable, and what text does it
 * match on" is one reviewable file rather than a decision smeared across
 * indexing use cases, providers, and job processors.
 *
 * Pure and synchronous on purpose — no repository, no clock of its own
 * (`indexedAt` is passed in), no I/O. Projection correctness is then
 * testable with plain object-in/object-out assertions, with no fakes at
 * all, and the same function is reused unchanged by single-document
 * indexing, batch indexing, and full rebuilds.
 *
 * ## Why the source types are the *discovery* candidates
 * `ProfessionalDiscoveryCandidate`/`CompanyDiscoveryCandidate` are
 * already the public-safe, ACTIVE-only, search-scoped view of these
 * entities (Module 19 built them for exactly that). Projecting from them
 * rather than from `ProfessionalRecord`/`CompanyRecord` means the index
 * physically cannot contain a suspended professional's profile or a
 * private field: eligibility and public-safety are enforced upstream, by
 * the repository, at the query level — not re-implemented here where the
 * two rules could drift apart.
 */

/**
 * Joins the fields that make up a document's free-text blob, dropping
 * empty/null parts and collapsing whitespace. A single normalized string
 * (rather than N nullable fields) is what lets every provider — including
 * the in-memory one — implement multi-field matching identically.
 */
function joinText(parts: (string | null | undefined)[]): string {
  return parts
    .filter((part): part is string => typeof part === "string" && part.trim().length > 0)
    .map((part) => part.trim().replace(/\s+/g, " "))
    .join(" ");
}

export function toProfessionalSearchDocument(
  candidate: ProfessionalDiscoveryCandidate,
  indexedAt: Date,
): SearchDocument {
  return {
    id: buildSearchDocumentId("PROFESSIONAL", candidate.id),
    kind: "PROFESSIONAL",
    entityId: candidate.id,
    title: candidate.displayName,
    subtitle: candidate.businessName,
    text: joinText([
      candidate.displayName,
      candidate.businessName,
      candidate.headline,
      candidate.city,
      candidate.province,
    ]),
    categoryIds: [...candidate.categoryIds],
    city: candidate.city,
    province: candidate.province,
    latitude: candidate.latitude,
    longitude: candidate.longitude,
    // The write model's `verificationStatus` is a multi-state moderation
    // value; the read model only ever needs the boolean the customer sees,
    // derived here exactly the way SearchDirectoryUseCase derives it.
    isVerified: candidate.verificationStatus === "VERIFIED",
    averageRating: candidate.averageRating,
    reviewCount: candidate.reviewCount,
    portfolioItemCount: candidate.portfolioItemCount,
    createdAt: candidate.createdAt.toISOString(),
    indexedAt: indexedAt.toISOString(),
  };
}

export function toCompanySearchDocument(candidate: CompanyDiscoveryCandidate, indexedAt: Date): SearchDocument {
  return {
    id: buildSearchDocumentId("COMPANY", candidate.id),
    kind: "COMPANY",
    entityId: candidate.id,
    title: candidate.displayName,
    subtitle: candidate.legalName,
    text: joinText([
      candidate.displayName,
      candidate.legalName,
      candidate.description,
      candidate.city,
      candidate.province,
    ]),
    categoryIds: [...candidate.categoryIds],
    city: candidate.city,
    province: candidate.province,
    latitude: candidate.latitude,
    longitude: candidate.longitude,
    isVerified: candidate.isVerified,
    averageRating: candidate.averageRating,
    reviewCount: candidate.reviewCount,
    portfolioItemCount: candidate.portfolioItemCount,
    createdAt: candidate.createdAt.toISOString(),
    indexedAt: indexedAt.toISOString(),
  };
}

/**
 * Service requests have no rating/verification/portfolio signals of their
 * own, so those fields are projected as their neutral values rather than
 * being made optional on `SearchDocument`. A uniform document shape is
 * what allows one index, one query path, and one ranking rule for all
 * three kinds; a per-kind shape would push `kind` branching into every
 * provider.
 *
 * `photos`, `budget`, and the customer's identity are deliberately not
 * projected: the first two are display concerns the caller re-reads from
 * the write model once the user opens a request, and the third is never
 * public.
 */
export function toServiceRequestSearchDocument(request: ServiceRequestRecord, indexedAt: Date): SearchDocument {
  return {
    id: buildSearchDocumentId("SERVICE_REQUEST", request.id),
    kind: "SERVICE_REQUEST",
    entityId: request.id,
    title: request.title,
    subtitle: request.categoryName,
    text: joinText([
      request.title,
      request.description,
      request.categoryName,
      request.location.city,
      request.location.province,
    ]),
    categoryIds: [request.categoryId],
    city: request.location.city,
    province: request.location.province,
    latitude: request.location.latitude ?? null,
    longitude: request.location.longitude ?? null,
    isVerified: false,
    averageRating: null,
    reviewCount: 0,
    portfolioItemCount: 0,
    createdAt: request.createdAt.toISOString(),
    indexedAt: indexedAt.toISOString(),
  };
}
