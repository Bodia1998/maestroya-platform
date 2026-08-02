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

/** Forward geocoding: a full street address → coordinates. */
export interface FullAddress {
  line1?: string;
  city: string;
  province?: string | null;
  postalCode?: string | null;
  country?: string | null;
}

/** Reverse geocoding result: the address found at a given coordinate. */
export interface ReverseGeocodeResult {
  address: FullAddress;
  point: GeoPoint;
}

/**
 * One city/town/municipality autocomplete or municipality-search result.
 * `isMunicipality` distinguishes an official Spanish municipality (the
 * unit `validateMunicipality`-style checks would care about) from a
 * smaller locality/neighborhood a vendor's autocomplete might also
 * suggest — optional, since `StaticCityGeocodingProvider` and most
 * `searchCities` implementations won't have that distinction to offer.
 */
export interface CitySuggestion {
  label: string;
  city: string;
  province?: string | null;
  postalCode?: string | null;
  point?: GeoPoint;
  isMunicipality?: boolean;
}

/**
 * Thrown by a `GeocodingProvider` method that is a real, callable part of
 * the interface but has no implementation yet on the provider actually
 * configured (see `BaseGeocodingProvider.notImplemented`). Deliberately a
 * distinct, named error type — never a bare `Error` — so a caller can
 * catch specifically "this capability isn't wired up yet" and degrade
 * (e.g. hide an autocomplete UI, skip a reverse-geocode preview) instead
 * of treating it the same as a real request failure.
 */
export class GeocodingNotImplementedError extends Error {
  constructor(providerName: string, feature: string) {
    super(`${providerName} does not implement ${feature}.`);
    this.name = "GeocodingNotImplementedError";
  }
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

  /**
   * Module 27 — Spain Location Services: future-capability seam.
   *
   * `reverseGeocode`/`searchCities` are declared here, on the primary
   * `GeocodingProvider` interface a future module will import and depend
   * on, so that module never needs a second, parallel interface or a
   * breaking change to this one when these capabilities are actually
   * implemented — exactly the concern this hardening pass addresses.
   *
   * Both are **optional** (`?`) precisely so declaring them here today
   * does not break any existing implementer: `StaticCityGeocodingProvider`,
   * every `HttpGeocodingProvider`/`BaseGeocodingProvider` subclass, and
   * every test fake across this codebase that implements `GeocodingProvider`
   * continue to compile and behave identically without adding either
   * method. A caller that needs one of these capabilities checks for it
   * (`provider.searchCities ? ... : ...`) or calls it and is prepared to
   * catch `GeocodingNotImplementedError` — see `BaseGeocodingProvider`'s
   * default implementations, which every real vendor provider inherits
   * and none has overridden yet (no vendor call for these was built,
   * since there is no API key to exercise them against).
   */

  /** Reverse geocoding: coordinates → the address at that point. */
  reverseGeocode?(point: GeoPoint): Promise<ReverseGeocodeResult | null>;

  /**
   * City/town/municipality autocomplete for a partial query string —
   * covers both "city autocomplete" (suggest-as-you-type in a location
   * form) and "municipality search" (find the official municipality a
   * free-text name refers to), since in Spain's administrative model a
   * municipality *is* the city/town unit this app already asks users for.
   */
  searchCities?(partialQuery: string, province?: string | null): Promise<CitySuggestion[]>;
}
