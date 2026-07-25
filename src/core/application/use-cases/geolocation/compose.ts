import { StaticCityGeocodingProvider } from "@/infrastructure/geocoding/static-city-geocoding-provider";
import { GeocodeCityUseCase } from "@/application/use-cases/geolocation/geocode-city.use-case";

/**
 * Maps & Geolocation module (Module 20) — composition root.
 *
 * Wires the default, network-free `StaticCityGeocodingProvider` behind the
 * `GeocodingProvider` interface. Swapping in a real provider later (a real
 * maps/geocoding API) means changing this one file — no use case or caller
 * changes.
 */
export const geocodingProvider = new StaticCityGeocodingProvider();

export function makeGeocodeCityUseCase() {
  return new GeocodeCityUseCase(geocodingProvider);
}
