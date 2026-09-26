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
    .max(100, "maxLength")
    .optional()
    .transform((value) => (value && value.length > 0 ? value : undefined)),
  categoryId: z.string().uuid("dto.categories.invalid").optional(),
  city: z
    .string()
    .trim()
    .max(100, "maxLength")
    .optional()
    .transform((value) => (value && value.length > 0 ? value : undefined)),
  province: z
    .string()
    .trim()
    .max(100, "maxLength")
    .optional()
    .transform((value) => (value && value.length > 0 ? value : undefined)),
  verifiedOnly: z.coerce.boolean().optional().default(false),
  minRating: z.coerce
    .number({ invalid_type_error: "dto.search.minRatingInvalid" })
    .min(1, "dto.search.minRatingRange")
    .max(5, "dto.search.minRatingRange")
    .optional(),
  minReviewCount: z.coerce
    .number({ invalid_type_error: "dto.search.minReviewCountInvalid" })
    .int()
    .min(0, "dto.search.minReviewCountNegative")
    .max(100000, "dto.search.minReviewCountTooLarge")
    .optional(),
  sortBy: z.enum(SEARCH_SORT_OPTIONS).optional().default("RELEVANCE"),
  page: z.coerce.number().int().min(1).max(1000).optional().default(1),
  pageSize: z.coerce.number().int().min(1).max(50).optional().default(20),
  /**
   * Maps & Geolocation module (Module 20): optional client-supplied search
   * point (e.g. from browser geolocation or a future map picker) and radius
   * — additive alongside every Module 19 field above, following exactly the
   * "ProfessionalSearchFilter/CompanySearchFilter can grow latitude/
   * longitude/radiusKm fields additively" extension point Module 19's own
   * documentation forward-referenced. Bounded to valid coordinate ranges and
   * a sane maximum radius (200km — larger than Spain's largest province) to
   * prevent pathological/abusive queries, the same reasoning
   * `searchDirectorySchema`'s query-length/page/rating bounds already give.
   * `radiusKm` without `latitude`/`longitude` (or vice versa) is rejected —
   * a radius is meaningless without a center point.
   */
  latitude: z.coerce
    .number({ invalid_type_error: "dto.location.latitudeInvalid" })
    .min(-90, "dto.location.latitudeRange")
    .max(90, "dto.location.latitudeRange")
    .optional(),
  longitude: z.coerce
    .number({ invalid_type_error: "dto.location.longitudeInvalid" })
    .min(-180, "dto.location.longitudeRange")
    .max(180, "dto.location.longitudeRange")
    .optional(),
  radiusKm: z.coerce
    .number({ invalid_type_error: "dto.search.radiusInvalid" })
    .positive("dto.search.radiusPositive")
    .max(200, "dto.search.radiusMax")
    .optional(),
})
  .refine((value) => (value.latitude === undefined) === (value.longitude === undefined), {
    message: "dto.search.coordinatesTogether",
    path: ["longitude"],
  })
  .refine((value) => value.radiusKm === undefined || value.latitude !== undefined, {
    message: "dto.search.radiusRequiresLocation",
    path: ["radiusKm"],
  });

export type SearchDirectoryInput = z.infer<typeof searchDirectorySchema>;
