import "server-only";

import type { CityGeocodeQuery } from "@/domain/repositories/geocoding-provider";
import type { GeoPoint } from "@/domain/services/geo-distance";
import { BaseGeocodingProvider } from "@/infrastructure/geocoding/base-geocoding-provider";
import type { GeocodingHttpClient } from "@/infrastructure/geocoding/geocoding-http-client";

/**
 * Module 27 — Spain Location Services.
 *
 * `GeocodingProvider` backed by the HERE Geocoding & Search API v7
 * (https://www.here.com/docs/bundle/geocoding-and-search-api-developer-guide/page/README.html).
 * Not enabled by default — only constructed by `createGeocodingProvider()`
 * when `GEOCODING_PROVIDER=HERE` **and** `HERE_API_KEY` is non-empty. No
 * key is hardcoded or required anywhere in this codebase.
 *
 * `in=countryCode:ESP` restricts results to Spain, matching the same
 * city-level resolution scope every other provider in this module keeps.
 */
export class HereGeocodingProvider extends BaseGeocodingProvider {
  protected readonly providerName = "here";

  constructor(
    private readonly apiKey: string,
    httpClient?: GeocodingHttpClient,
  ) {
    super(httpClient);
  }

  protected buildRequestUrl(query: CityGeocodeQuery): string | null {
    if (!this.apiKey) return null;

    const q = [query.city, query.province].filter(Boolean).join(", ");
    const params = new URLSearchParams({
      q,
      in: "countryCode:ESP",
      limit: "1",
      apiKey: this.apiKey,
    });

    return `https://geocode.search.hereapi.com/v1/geocode?${params.toString()}`;
  }

  protected parseResponse(json: unknown): GeoPoint | null {
    const body = json as { items?: Array<{ position?: { lat?: number; lng?: number } }> };
    const position = body.items?.[0]?.position;
    if (!position || typeof position.lat !== "number" || typeof position.lng !== "number") return null;

    return { latitude: position.lat, longitude: position.lng };
  }
}
