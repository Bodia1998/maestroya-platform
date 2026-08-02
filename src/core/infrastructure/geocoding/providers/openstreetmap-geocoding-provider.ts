import "server-only";

import type { CityGeocodeQuery } from "@/domain/repositories/geocoding-provider";
import type { GeoPoint } from "@/domain/services/geo-distance";
import { BaseGeocodingProvider } from "@/infrastructure/geocoding/base-geocoding-provider";
import type { GeocodingHttpClient } from "@/infrastructure/geocoding/geocoding-http-client";

/**
 * Module 27 — Spain Location Services.
 *
 * `GeocodingProvider` backed by OpenStreetMap's Nominatim search API
 * (https://nominatim.org/release-docs/latest/api/Search/). The one
 * provider in this module that needs **no API key at all** — selected via
 * `GEOCODING_PROVIDER=OSM` alone. Still not enabled by default (the
 * factory's default fallback remains `StaticCityGeocodingProvider` unless
 * `GEOCODING_PROVIDER` is explicitly set — see
 * `geocoding-provider-factory.ts`), so no outbound network call happens
 * unless this is deliberately turned on.
 *
 * Nominatim's usage policy (https://operations.osmfoundation.org/policies/nominatim/)
 * requires a descriptive `User-Agent` identifying the application — sent
 * via `requestInit()` — and caps free usage at ~1 request/second, which is
 * exactly why this provider is always used behind `CachedGeocodingProvider`
 * (see the factory): repeated lookups of the same city/province never
 * re-hit Nominatim.
 */
export class OpenStreetMapGeocodingProvider extends BaseGeocodingProvider {
  protected readonly providerName = "osm";

  constructor(httpClient?: GeocodingHttpClient) {
    super(httpClient);
  }

  protected buildRequestUrl(query: CityGeocodeQuery): string | null {
    const q = [query.city, query.province, "Spain"].filter(Boolean).join(", ");
    const params = new URLSearchParams({
      q,
      countrycodes: "es",
      format: "json",
      limit: "1",
    });

    return `https://nominatim.openstreetmap.org/search?${params.toString()}`;
  }

  protected override requestInit(): RequestInit {
    return { headers: { "User-Agent": "MaestroYa/1.0 (geocoding; contact: support@maestroya.es)" } };
  }

  protected parseResponse(json: unknown): GeoPoint | null {
    const body = json as Array<{ lat?: string; lon?: string }>;
    const first = Array.isArray(body) ? body[0] : undefined;
    if (!first?.lat || !first?.lon) return null;

    const latitude = Number.parseFloat(first.lat);
    const longitude = Number.parseFloat(first.lon);
    if (Number.isNaN(latitude) || Number.isNaN(longitude)) return null;

    return { latitude, longitude };
  }
}
