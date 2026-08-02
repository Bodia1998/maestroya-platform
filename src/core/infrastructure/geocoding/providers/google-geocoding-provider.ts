import "server-only";

import type { CityGeocodeQuery } from "@/domain/repositories/geocoding-provider";
import type { GeoPoint } from "@/domain/services/geo-distance";
import { BaseGeocodingProvider } from "@/infrastructure/geocoding/base-geocoding-provider";
import type { GeocodingHttpClient } from "@/infrastructure/geocoding/geocoding-http-client";

/**
 * Module 27 — Spain Location Services.
 *
 * `GeocodingProvider` backed by the Google Maps Geocoding API
 * (https://developers.google.com/maps/documentation/geocoding). Not
 * enabled by default — only constructed by `createGeocodingProvider()`
 * when `GEOCODING_PROVIDER=GOOGLE` **and** `GOOGLE_GEOCODING_API_KEY` is
 * non-empty. No key is hardcoded or required anywhere in this codebase.
 *
 * `region=es` biases (never strictly filters) results toward Spain,
 * matching the same "resolve a city name, not a full address" scope every
 * other provider in this module keeps.
 */
export class GoogleGeocodingProvider extends BaseGeocodingProvider {
  protected readonly providerName = "google";

  constructor(
    private readonly apiKey: string,
    httpClient?: GeocodingHttpClient,
  ) {
    super(httpClient);
  }

  protected buildRequestUrl(query: CityGeocodeQuery): string | null {
    if (!this.apiKey) return null;

    const address = [query.city, query.province, "Spain"].filter(Boolean).join(", ");
    const params = new URLSearchParams({
      address,
      region: "es",
      key: this.apiKey,
    });

    return `https://maps.googleapis.com/maps/api/geocode/json?${params.toString()}`;
  }

  protected parseResponse(json: unknown): GeoPoint | null {
    const body = json as {
      status?: string;
      results?: Array<{ geometry?: { location?: { lat?: number; lng?: number } } }>;
    };

    if (body.status !== "OK") return null;

    const location = body.results?.[0]?.geometry?.location;
    if (!location || typeof location.lat !== "number" || typeof location.lng !== "number") return null;

    return { latitude: location.lat, longitude: location.lng };
  }
}
