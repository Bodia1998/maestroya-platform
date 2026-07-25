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
    .number({ invalid_type_error: "Enter a valid latitude." })
    .min(-90, "Latitude must be between -90 and 90.")
    .max(90, "Latitude must be between -90 and 90.")
    .optional(),
  longitude: z.coerce
    .number({ invalid_type_error: "Enter a valid longitude." })
    .min(-180, "Longitude must be between -180 and 180.")
    .max(180, "Longitude must be between -180 and 180.")
    .optional(),
  radiusKm: z.coerce
    .number({ invalid_type_error: "Enter a valid search radius." })
    .positive("Search radius must be greater than zero.")
    .max(200, "Search radius must be 200km or fewer.")
    .optional(),
})
  .refine((value) => (value.latitude === undefined) === (value.longitude === undefined), {
    message: "Both latitude and longitude must be provided together.",
    path: ["longitude"],
  })
  .refine((value) => value.radiusKm === undefined || value.latitude !== undefined, {
    message: "A search radius requires latitude/longitude to be set.",
    path: ["radiusKm"],
  });

export type SearchDirectoryInput = z.infer<typeof searchDirectorySchema>;
