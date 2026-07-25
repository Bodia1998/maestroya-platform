/**
 * Search & Ranking module (Module 19).
 *
 * Domain-level enum for the sort options the unified directory search
 * exposes. Kept as a plain string union (not raw strings threaded through
 * the stack) so the application/presentation layers validate against a
 * closed set via Zod (`searchDirectorySchema`) instead of trusting
 * arbitrary client-supplied ordering strings, and so a Prisma `orderBy`
 * clause never leaks directly to the UI.
 */
export const SEARCH_SORT_OPTIONS = ["RELEVANCE", "RATING", "REVIEWS", "NEWEST", "VERIFIED"] as const;

export type SearchSortOption = (typeof SEARCH_SORT_OPTIONS)[number];
