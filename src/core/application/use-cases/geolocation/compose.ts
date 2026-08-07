import { createGeocodingProvider } from "@/infrastructure/geocoding/geocoding-provider-factory";
import { GeocodeCityUseCase } from "@/application/use-cases/geolocation/geocode-city.use-case";
import { ReverseGeocodeUseCase } from "@/application/use-cases/geolocation/reverse-geocode.use-case";

/**
 * Maps & Geolocation module (Module 20) — composition root, extended by
 * Module 27 (Spain Location Services).
 *
 * Wires whichever `GeocodingProvider` `createGeocodingProvider()` resolves
 * from configuration (`GEOCODING_PROVIDER` + the matching `*_API_KEY`;
 * defaults to the network-free `StaticCityGeocodingProvider` when unset)
 * behind the `GeocodingProvider` interface. This is the single shared
 * instance every composition root in the app uses — see
 * `professional/compose.ts` and `service-request/compose.ts`, which import
 * `geocodingProvider` from here rather than constructing their own, so
 * there is exactly one cache (`CachedGeocodingProvider`) for the whole
 * process. Swapping in a real provider later means an environment
 * variable change — no use case, caller, or compose-file change.
 */
export const geocodingProvider = createGeocodingProvider();

export function makeGeocodeCityUseCase() {
  return new GeocodeCityUseCase(geocodingProvider);
}

/**
 * Module 42 — Geocoding & Maps: reuses the exact same shared
 * `geocodingProvider` instance every other composition root in this file
 * uses — no second provider, no second cache. See
 * `ReverseGeocodeUseCase`'s own doc comment for why this needs no
 * authorization wiring.
 */
export function makeReverseGeocodeUseCase() {
  return new ReverseGeocodeUseCase(geocodingProvider);
}
