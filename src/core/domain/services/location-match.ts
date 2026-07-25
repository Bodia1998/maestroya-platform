/**
 * Search & Ranking module (Module 19) — location matching abstraction.
 *
 * Module 19 must be able to rank by location using only what already
 * exists (city/province strings on the candidate), without depending on
 * Module 20 (Maps & Geolocation). This is intentionally the *only* location
 * abstraction Module 19 needs: an exact city match, a same-province match,
 * or no match. `haversineDistanceKm`/`isWithinServiceRadius`
 * (@/domain/services/geo-distance) already provide the coordinate-based
 * primitive Professional Discovery uses for radius search — this module
 * reuses that instead of duplicating it wherever precise coordinates are
 * available for both the searched point and the candidate (see
 * `computeCoordinateLocationMatch`).
 *
 * Future extension point for Module 20: once every candidate reliably has
 * coordinates, a distance-banded match (e.g. "within 10km" / "within 50km")
 * can be added as a new LocationMatch member without changing this
 * function's signature or any caller — only the matching rule inside grows.
 */
import { haversineDistanceKm, type GeoPoint } from "@/domain/services/geo-distance";

export const LOCATION_MATCH_LEVELS = ["EXACT_CITY", "SAME_PROVINCE", "NONE"] as const;
export type LocationMatch = (typeof LOCATION_MATCH_LEVELS)[number];

export interface LocationQuery {
  city?: string | null;
  province?: string | null;
}

export interface LocationCandidate {
  city?: string | null;
  province?: string | null;
}

function normalize(value: string | null | undefined): string | null {
  if (!value) return null;
  const trimmed = value.trim().toLowerCase();
  return trimmed.length > 0 ? trimmed : null;
}

/**
 * City/province string matching — the baseline location signal that works
 * today for every professional and company, regardless of whether they have
 * coordinates set. Case-insensitive, whitespace-tolerant.
 *
 * When the search has no city/province filter at all, every candidate
 * matches equally (`NONE`) rather than being penalized — an unspecified
 * location preference should not affect ranking.
 */
export function computeLocationMatch(query: LocationQuery, candidate: LocationCandidate): LocationMatch {
  const queryCity = normalize(query.city);
  const queryProvince = normalize(query.province);
  const candidateCity = normalize(candidate.city);
  const candidateProvince = normalize(candidate.province);

  if (queryCity && candidateCity && queryCity === candidateCity) {
    return "EXACT_CITY";
  }
  if (queryProvince && candidateProvince && queryProvince === candidateProvince) {
    return "SAME_PROVINCE";
  }
  return "NONE";
}

/**
 * Coordinate-based refinement: when both the search point and the
 * candidate have coordinates, distance is a strictly better signal than a
 * city-name string match (it correctly handles a candidate whose base is in
 * a neighboring town but genuinely closer than one in the "same" city).
 * Falls back to `null` (meaning: use `computeLocationMatch` instead) when
 * either side lacks coordinates — Module 19 never requires coordinates to
 * function.
 */
export function computeCoordinateLocationMatch(
  searchPoint: GeoPoint | null,
  candidatePoint: GeoPoint | null,
): LocationMatch | null {
  if (!searchPoint || !candidatePoint) return null;

  const distanceKm = haversineDistanceKm(searchPoint, candidatePoint);
  if (distanceKm <= 15) return "EXACT_CITY";
  if (distanceKm <= 60) return "SAME_PROVINCE";
  return "NONE";
}
