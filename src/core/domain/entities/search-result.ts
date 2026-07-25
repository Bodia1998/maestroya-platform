/**
 * Search & Ranking module (Module 19).
 *
 * Unified, Prisma-free representation of a single search result. A
 * discriminated union (`kind`) rather than a merged/polymorphic shape —
 * same reasoning SearchCompaniesUseCase's own doc comment gives for keeping
 * professional and company discovery as distinct result types: a company is
 * not a professional wearing a different hat, and callers (UI, tests) can
 * narrow on `kind` to render/assert on the fields that actually exist for
 * each.
 *
 * Only public-safe fields appear here. Anything from verification (case
 * status history, documents, reviewer identity, rejection reasons) or
 * internal moderation is deliberately absent — see
 * docs/MODULE_19_SEARCH_RANKING.md, "Privacy & Security Boundaries".
 */

export type SearchResultKind = "PROFESSIONAL" | "COMPANY";

interface BaseSearchResult {
  kind: SearchResultKind;
  id: string;
  displayName: string;
  categoryIds: string[];
  city: string | null;
  province: string | null;
  profileImageUrl: string | null;
  isVerified: boolean;
  averageRating: number | null;
  reviewCount: number;
  portfolioItemCount: number;
  /** Human-readable, non-numeric reasons this result ranked where it did —
   *  see ranking-engine.ts's `RankingScore.reasons`. Safe to show to
   *  customers; never includes the underlying numeric score. */
  rankingReasons: string[];
}

export interface ProfessionalSearchResult extends BaseSearchResult {
  kind: "PROFESSIONAL";
  businessName: string | null;
  headline: string | null;
  yearsExperience: number | null;
  hourlyRate: number | null;
}

export interface CompanySearchResult extends BaseSearchResult {
  kind: "COMPANY";
  legalName: string;
  description: string | null;
  teamSize: number;
}

export type SearchResult = ProfessionalSearchResult | CompanySearchResult;

export interface UnifiedSearchResultPage {
  items: SearchResult[];
  page: number;
  pageSize: number;
  total: number;
}
