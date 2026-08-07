import { z } from "zod";

import { SEARCH_DOCUMENT_KINDS } from "@/domain/entities/search-document";

/**
 * Module 47 — CQRS Search Engine (Roadmap Module 14).
 *
 * Validation for the read side. Deliberately modelled on Module 19's
 * `searchDirectorySchema` (same field names, same bounds, same
 * "everything optional, absent means unfiltered" convention) so the two
 * search entry points are interchangeable from a caller's point of view
 * and a page can be moved from the Postgres pipeline to the read model
 * without rewriting its form.
 *
 * The limits are the same anti-abuse limits Module 19 documents: a
 * bounded query length, bounded pagination, and a bounded category list
 * exist so a hostile client cannot turn one HTTP request into an
 * arbitrarily expensive engine query. They matter *more* here, not less:
 * a search engine will happily accept a 10,000-character fuzzy query and
 * spend real CPU on it.
 *
 * As in Module 19, nothing here can widen visibility. `kinds`,
 * `verifiedOnly`, and the rest only ever narrow an already-public
 * corpus — the index contains only public-safe, eligibility-filtered
 * documents in the first place (see `SearchDocumentProjector`).
 */
export const searchReadModelSchema = z.object({
  query: z
    .string()
    .trim()
    .max(100, "Search text must be 100 characters or fewer.")
    .optional()
    .transform((value) => (value && value.length > 0 ? value : undefined)),
  kinds: z.array(z.enum(SEARCH_DOCUMENT_KINDS as unknown as [string, ...string[]])).optional(),
  categoryIds: z.array(z.string().uuid("Select a valid service category.")).max(20).optional(),
  city: z
    .string()
    .trim()
    .max(100, "City must be 100 characters or fewer.")
    .optional()
    .transform((value) => (value && value.length > 0 ? value : undefined)),
  province: z
    .string()
    .trim()
    .max(100, "Province must be 100 characters or fewer.")
    .optional()
    .transform((value) => (value && value.length > 0 ? value : undefined)),
  verifiedOnly: z.coerce.boolean().optional().default(false),
  minRating: z.coerce.number().min(1).max(5).optional(),
  minReviewCount: z.coerce.number().int().min(0).max(100000).optional(),
  latitude: z.coerce.number().min(-90).max(90).optional(),
  longitude: z.coerce.number().min(-180).max(180).optional(),
  radiusKm: z.coerce.number().positive().max(500).optional(),
  sortBy: z.enum(["RELEVANCE", "RATING", "REVIEWS", "NEWEST", "DISTANCE"]).optional().default("RELEVANCE"),
  fuzzy: z.coerce.boolean().optional().default(true),
  page: z.coerce.number().int().min(1).max(1000).optional().default(1),
  pageSize: z.coerce.number().int().min(1).max(50).optional().default(20),
});

export type SearchReadModelInput = z.infer<typeof searchReadModelSchema>;
