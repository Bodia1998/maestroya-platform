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
