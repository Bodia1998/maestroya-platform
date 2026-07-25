/**
 * Maps & Geolocation module (Module 20) — coordinate fuzzing for public
 * display.
 *
 * Professional Discovery and Search & Ranking already treat exact
 * coordinates as private: `ProfessionalPublicProfileRecord` and
 * `CompanyPublicProfileRecord` never include `latitude`/`longitude` at all
 * (see `professional-discovery-repository.ts`/`company-discovery-repository.ts`
 * doc comments — "never the exact street address or coordinates of the
 * professional's home/base"). Many professionals operate out of a home
 * address, so even a "rounded" coordinate can reveal roughly where someone
 * lives if it is precise enough.
 *
 * A future map UI (Module 20's own forward-looking scope — see
 * docs/MODULE_20_MAPS_GEOLOCATION.md) still needs *some* point to place a
 * marker at. `fuzzCoordinate` snaps a coordinate to a coarse grid so the
 * exposed point is only ever accurate to "somewhere in this ~5-6km cell",
 * never the precise base location — deliberately coarser than
 * `computeCoordinateLocationMatch`'s own 15km "EXACT_CITY" band, so a
 * fuzzed point is never precise enough to defeat that band's own privacy
 * assumption.
 */
import type { GeoPoint } from "@/domain/services/geo-distance";

/** ~0.05 degrees of latitude ≈ 5.6km — coarse enough to avoid exposing a
 *  professional's or company's precise base location, still fine enough to
 *  place a meaningfully-positioned marker within a city. */
export const DEFAULT_FUZZ_GRID_DEGREES = 0.05;

function snapToGrid(value: number, gridDegrees: number): number {
  return Math.round(value / gridDegrees) * gridDegrees;
}

/**
 * Deterministic — the same input coordinate always fuzzes to the same
 * output, so repeated searches/pages show a stable marker position rather
 * than jittering on every request.
 */
export function fuzzCoordinate(point: GeoPoint, gridDegrees: number = DEFAULT_FUZZ_GRID_DEGREES): GeoPoint {
  return {
    latitude: Number(snapToGrid(point.latitude, gridDegrees).toFixed(4)),
    longitude: Number(snapToGrid(point.longitude, gridDegrees).toFixed(4)),
  };
}
