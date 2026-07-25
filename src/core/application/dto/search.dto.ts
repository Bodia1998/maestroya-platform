import { z } from "zod";

import { SEARCH_SORT_OPTIONS } from "@/domain/value-objects/search-sort-option";

/**
 * Search & Ranking module (Module 19).
 *
 * Unified directory search DTO — one schema shared by the client-facing
 * search form and the page/Server Action that receives it, same convention
 * as discovery.dto.ts/company.dto.ts. Deliberately absent, same reasoning
 * as searchProfessionalsSchema: any field that would let the public client
 * control status/verificationStatus/eligibility-for-search directly — those
 * are enforced server-side in the discovery repositories, never accepted
 * here. `verifiedOnly` only ever narrows results to already-eligible
 * (ACTIVE, non-deleted) candidates; it cannot widen access to anything a
 * plain search wouldn't already return.
 *
 * Limits (query length, pagination bounds, rating range) exist specifically
 * to prevent pathological/abusive queries (Module 19 requirement — "Search
 * Query Validation").
 */
export const searchDirectorySchema = z.object({
  query: z
    .string()
    .trim()
    .max(100, "Search text must be 100 characters or fewer.")
    .optional()
    .transform((value) => (value && value.length > 0 ? value : undefined)),
  categoryId: z.string().uuid("Select a valid service category.").optional(),
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
  minRating: z.coerce
    .number({ invalid_type_error: "Enter a valid minimum rating." })
    .min(1, "Minimum rating must be between 1 and 5.")
    .max(5, "Minimum rating must be between 1 and 5.")
    .optional(),
  minReviewCount: z.coerce
    .number({ invalid_type_error: "Enter a valid minimum review count." })
    .int()
    .min(0, "Minimum review count cannot be negative.")
    .max(100000, "Minimum review count is too large.")
    .optional(),
  sortBy: z.enum(SEARCH_SORT_OPTIONS).optional().default("RELEVANCE"),
  page: z.coerce.number().int().min(1).max(1000).optional().default(1),
  pageSize: z.coerce.number().int().min(1).max(50).optional().default(20),
});

export type SearchDirectoryInput = z.infer<typeof searchDirectorySchema>;
