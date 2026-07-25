import type { CityGeocodeQuery, GeocodingProvider } from "@/domain/repositories/geocoding-provider";
import type { GeoPoint } from "@/domain/services/geo-distance";

/**
 * Maps & Geolocation module (Module 20) — default `GeocodingProvider`
 * implementation.
 *
 * Deliberately NOT a real geocoding service. There is no Google
 * Maps/Mapbox/HERE (or any other) geocoding API key, SDK, or network
 * dependency anywhere in this codebase (see package.json), and this module
 * does not add one — the same "ship the abstraction, not the vendor
 * integration" treatment this project already gives Stripe for Module 12.
 *
 * Instead, this is a small, static, hand-maintained lookup table of
 * centroid coordinates for major Spanish cities/provinces — good enough to:
 *   - resolve a plain city name typed into the search form to an
 *     approximate point, so `computeCoordinateLocationMatch` (which Module
 *     19 built and unit-tested but never had a caller that could invoke it)
 *     can run for candidates who have coordinates but whose city string
 *     doesn't literally match the query's city string (e.g. a professional
 *     based in a small town within commuting distance of the searched
 *     city);
 *   - give `GeocodeCityUseCase` something concrete to return today, without
 *     making this module's correctness depend on network access to a paid
 *     external API existing (or being reachable in this sandbox at all —
 *     see docs/MODULE_20_MAPS_GEOLOCATION.md, "Environment limitations").
 *
 * This is explicitly NOT precise street-address geocoding — it resolves to
 * a city's centroid, accurate to a few kilometers at best, which is exactly
 * the granularity `computeCoordinateLocationMatch`'s 15km/60km bands need
 * and no more. A real provider (wired in behind the same `GeocodingProvider`
 * interface) is the documented future integration point for anything more
 * precise.
 */
interface CityEntry {
  city: string;
  province: string;
  point: GeoPoint;
}

// Centroids sourced from well-known public city-center coordinates for
// Spain's most populous cities/provincial capitals — deliberately a small,
// reviewable list rather than an attempt at national coverage.
const CITY_TABLE: CityEntry[] = [
  { city: "Madrid", province: "Madrid", point: { latitude: 40.4168, longitude: -3.7038 } },
  { city: "Barcelona", province: "Barcelona", point: { latitude: 41.3874, longitude: 2.1686 } },
  { city: "Valencia", province: "Valencia", point: { latitude: 39.4699, longitude: -0.3763 } },
  { city: "Sevilla", province: "Sevilla", point: { latitude: 37.3891, longitude: -5.9845 } },
  { city: "Zaragoza", province: "Zaragoza", point: { latitude: 41.6488, longitude: -0.8891 } },
  { city: "Malaga", province: "Malaga", point: { latitude: 36.7213, longitude: -4.4213 } },
  { city: "Murcia", province: "Murcia", point: { latitude: 37.9922, longitude: -1.1307 } },
  { city: "Palma", province: "Illes Balears", point: { latitude: 39.5696, longitude: 2.6502 } },
  { city: "Las Palmas de Gran Canaria", province: "Las Palmas", point: { latitude: 28.1235, longitude: -15.436 } },
  { city: "Bilbao", province: "Bizkaia", point: { latitude: 43.263, longitude: -2.935 } },
  { city: "Alicante", province: "Alicante", point: { latitude: 38.3452, longitude: -0.481 } },
  { city: "Cordoba", province: "Cordoba", point: { latitude: 37.8882, longitude: -4.7794 } },
  { city: "Valladolid", province: "Valladolid", point: { latitude: 41.6523, longitude: -4.7245 } },
  { city: "Vigo", province: "Pontevedra", point: { latitude: 42.2406, longitude: -8.7207 } },
  { city: "Gijon", province: "Asturias", point: { latitude: 43.5322, longitude: -5.6611 } },
  { city: "Gandia", province: "Valencia", point: { latitude: 38.9665, longitude: -0.1817 } },
  { city: "Oviedo", province: "Asturias", point: { latitude: 43.3603, longitude: -5.8448 } },
  { city: "Santa Cruz de Tenerife", province: "Santa Cruz de Tenerife", point: { latitude: 28.4636, longitude: -16.2518 } },
  { city: "Pamplona", province: "Navarra", point: { latitude: 42.8125, longitude: -1.6458 } },
  { city: "Almeria", province: "Almeria", point: { latitude: 36.8381, longitude: -2.4597 } },
  { city: "San Sebastian", province: "Gipuzkoa", point: { latitude: 43.3183, longitude: -1.9812 } },
  { city: "Santander", province: "Cantabria", point: { latitude: 43.4623, longitude: -3.8099 } },
  { city: "Castellon de la Plana", province: "Castellon", point: { latitude: 39.9864, longitude: -0.0513 } },
  { city: "Toledo", province: "Toledo", point: { latitude: 39.8628, longitude: -4.0273 } },
  { city: "Granada", province: "Granada", point: { latitude: 37.1773, longitude: -3.5986 } },
  { city: "Logrono", province: "La Rioja", point: { latitude: 42.4627, longitude: -2.4449 } },
  { city: "Badajoz", province: "Badajoz", point: { latitude: 38.8794, longitude: -6.9707 } },
  { city: "Salamanca", province: "Salamanca", point: { latitude: 40.9701, longitude: -5.6635 } },
  { city: "Huelva", province: "Huelva", point: { latitude: 37.2614, longitude: -6.9447 } },
  { city: "Lleida", province: "Lleida", point: { latitude: 41.6176, longitude: 0.62 } },
];

const COMBINING_DIACRITICS_PATTERN = /[\u0300-\u036f]/g;

function normalize(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .normalize("NFD")
    .replace(COMBINING_DIACRITICS_PATTERN, ""); // strip combining diacritics (a/e/i/o/u/n, etc.)
}

export class StaticCityGeocodingProvider implements GeocodingProvider {
  async geocode(query: CityGeocodeQuery): Promise<GeoPoint | null> {
    const normalizedCity = normalize(query.city);
    const normalizedProvince = query.province ? normalize(query.province) : undefined;

    const cityMatches = CITY_TABLE.filter((entry) => normalize(entry.city) === normalizedCity);
    const first = cityMatches[0];
    if (!first) return null;
    if (cityMatches.length === 1) return first.point;

    // More than one city shares this name (not expected in the current
    // table, but the lookup is written defensively) — disambiguate by
    // province when given, otherwise return the first deterministic match
    // rather than throwing.
    const disambiguated = normalizedProvince
      ? cityMatches.find((entry) => normalize(entry.province) === normalizedProvince)
      : undefined;
    return (disambiguated ?? first).point;
  }
}
