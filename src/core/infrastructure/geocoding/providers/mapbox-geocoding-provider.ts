import "server-only";

import type { CityGeocodeQuery } from "@/domain/repositories/geocoding-provider";
import type { GeoPoint } from "@/domain/services/geo-distance";
import { BaseGeocodingProvider } from "@/infrastructure/geocoding/base-geocoding-provider";
import type { GeocodingHttpClient } from "@/infrastructure/geocoding/geocoding-http-client";

/**
 * Module 27 — Spain Location Services.
 *
 * `GeocodingProvider` backed by Mapbox's Geocoding API
 * (https://docs.mapbox.com/api/search/geocoding/). Not enabled by
 * default — only constructed by `createGeocodingProvider()` when
 * `GEOCODING_PROVIDER=MAPBOX` **and** `MAPBOX_API_KEY` is non-empty (see
 * `geocoding-provider-factory.ts`). No key is hardcoded or required
 * anywhere in this codebase; `MAPBOX_API_KEY=""` in `.env.example` is
 * intentional.
 *
 * Query is scoped to Spain (`country=es`) and to place-level results
 * (`types=place,locality,municipality`) — the deliberately narrow
 * "resolve a city name" scope `GeocodingProvider.geocode` documents, not a
 * full street-address geocoder.
 */
export class MapboxGeocodingProvider extends BaseGeocodingProvider {
  protected readonly providerName = "mapbox";

  constructor(
    private readonly apiKey: string,
    httpClient?: GeocodingHttpClient,
  ) {
    super(httpClient);
  }

  protected buildRequestUrl(query: CityGeocodeQuery): string | null {
    if (!this.apiKey) return null;

    const searchText = [query.city, query.province].filter(Boolean).join(", ");
    const params = new URLSearchParams({
      access_token: this.apiKey,
      country: "es",
      types: "place,locality,municipality",
      limit: "1",
    });

    return `https://api.mapbox.com/geocoding/v5/mapbox.places/${encodeURIComponent(searchText)}.json?${params.toString()}`;
  }

  protected parseResponse(json: unknown): GeoPoint | null {
    const body = json as { features?: Array<{ center?: [number, number] }> };
    const center = body.features?.[0]?.center;
    if (!Array.isArray(center) || center.length !== 2) return null;

    const [longitude, latitude] = center;
    if (typeof latitude !== "number" || typeof longitude !== "number") return null;

    return { latitude, longitude };
  }
}
