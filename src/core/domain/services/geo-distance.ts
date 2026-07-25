/**
 * Professional Discovery & Search module — geographic distance utility.
 *
 * Deliberately a plain, dependency-free domain service (no Prisma, no
 * external geocoding provider) so it stays independently testable and easy
 * to later swap for a database-level calculation (PostGIS, a spatial
 * index, etc.) without touching any use case that depends on it.
 */

export interface GeoPoint {
  latitude: number;
  longitude: number;
}

const EARTH_RADIUS_KM = 6371;

function toRadians(degrees: number): number {
  return (degrees * Math.PI) / 180;
}

/**
 * Great-circle distance between two points using the Haversine formula.
 * Deterministic and pure — same inputs always produce the same output,
 * which is what makes it independently unit-testable.
 */
export function haversineDistanceKm(a: GeoPoint, b: GeoPoint): number {
  const dLat = toRadians(b.latitude - a.latitude);
  const dLon = toRadians(b.longitude - a.longitude);

  const lat1 = toRadians(a.latitude);
  const lat2 = toRadians(b.latitude);

  const h =
    Math.sin(dLat / 2) ** 2 + Math.sin(dLon / 2) ** 2 * Math.cos(lat1) * Math.cos(lat2);

  const c = 2 * Math.asin(Math.min(1, Math.sqrt(h)));

  return EARTH_RADIUS_KM * c;
}

/**
 * Core business rule of the Professional Discovery module: a professional
 * is reachable for a given search location if and only if the distance
 * from that location to the professional's own base location is within
 * the professional's own configured service radius. There is no global
 * platform radius — every professional's radius is evaluated individually.
 */
export function isWithinServiceRadius(
  searchPoint: GeoPoint,
  professionalPoint: GeoPoint,
  serviceRadiusKm: number,
): boolean {
  return haversineDistanceKm(searchPoint, professionalPoint) <= serviceRadiusKm;
}

/** A cheap, SQL-pushable rectangular approximation of a circle of radius
 *  `radiusKm` around `center` — degrees-of-latitude are a near-constant
 *  111.32km, so the latitude band is exact; degrees-of-longitude shrink
 *  with `cos(latitude)`, so the longitude band widens as you go poleward.
 *  Deliberately a superset of the true circle (never a subset) — some
 *  false positives are expected and must be trimmed afterwards with the
 *  precise `haversineDistanceKm` cutoff (see
 *  `isWithinServiceRadius`/Module 20's repository `searchCandidates`
 *  implementations), the same "cheap DB filter, precise app-layer rule"
 *  split this module already uses for `serviceRadiusKm` matching. */
export interface BoundingBox {
  minLatitude: number;
  maxLatitude: number;
  minLongitude: number;
  maxLongitude: number;
}

const KM_PER_DEGREE_LATITUDE = 111.32;

export function computeBoundingBox(center: GeoPoint, radiusKm: number): BoundingBox {
  const safeRadiusKm = Math.max(0, radiusKm);
  const latDelta = safeRadiusKm / KM_PER_DEGREE_LATITUDE;

  // Guard against the pole singularity (cos(90deg) === 0) — clamp to a
  // latitude just short of the pole so longitude delta stays finite. Not a
  // realistic case for a Spain-focused marketplace, but the function must
  // still return a well-formed box for any valid latitude input.
  const clampedLatitudeForCos = Math.min(89.9, Math.abs(center.latitude));
  const kmPerDegreeLongitude = KM_PER_DEGREE_LATITUDE * Math.cos(toRadians(clampedLatitudeForCos));
  const lonDelta = kmPerDegreeLongitude > 0 ? safeRadiusKm / kmPerDegreeLongitude : 180;

  return {
    minLatitude: Math.max(-90, center.latitude - latDelta),
    maxLatitude: Math.min(90, center.latitude + latDelta),
    minLongitude: Math.max(-180, center.longitude - lonDelta),
    maxLongitude: Math.min(180, center.longitude + lonDelta),
  };
}
