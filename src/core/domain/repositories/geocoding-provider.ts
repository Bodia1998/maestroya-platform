import type { GeoPoint } from "@/domain/services/geo-distance";

/**
 * Maps & Geolocation module (Module 20) — injectable geocoding abstraction.
 *
 * No real geocoding/maps API (Google Maps, Mapbox, etc.) exists in this
 * codebase yet (see package.json — no such dependency), and none is added
 * by this module, matching the "no maps API ... was added" boundary Module
 * 19 already documented for itself. This interface is the seam a real
 * provider plugs into later (e.g. `GoogleGeocodingProvider`,
 * `MapboxGeocodingProvider`) without any caller (`SearchDirectoryUseCase`,
 * `GeocodeCityUseCase`) changing at all — the same "ship the abstraction,
 * not the vendor integration" treatment this project already gives Stripe
 * for Module 12.
 *
 * Deliberately narrow: city/province in, an approximate centroid point (or
 * `null` when unknown) out. Not a full street-address geocoder — see
 * `StaticCityGeocodingProvider`'s own doc comment for why that's the right
 * scope for the default implementation.
 */
export interface CityGeocodeQuery {
  city: string;
  province?: string | null;
  country?: string | null;
}

export interface GeocodingProvider {
  /**
   * Resolves a city (optionally scoped by province/country) to an
   * approximate coordinate. Returns `null` when the provider has no
   * knowledge of the given city — callers must treat that exactly like "no
   * coordinates available" (the same fallback `computeCoordinateLocationMatch`
   * already defines), never as an error.
   */
  geocode(query: CityGeocodeQuery): Promise<GeoPoint | null>;
}
