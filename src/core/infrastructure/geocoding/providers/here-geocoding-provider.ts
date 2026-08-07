import "server-only";

import type { CityGeocodeQuery, FullAddress, ReverseGeocodeResult } from "@/domain/repositories/geocoding-provider";
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

  /**
   * Module 42 — Geocoding & Maps. HERE's Reverse Geocode v7 endpoint
   * (https://www.here.com/docs/bundle/geocoding-and-search-api-developer-guide/page/topics/endpoint-reverse-geocode-brief.html) —
   * same auth/key precondition as `geocode()`.
   */
  override async reverseGeocode(point: GeoPoint): Promise<ReverseGeocodeResult | null> {
    if (!this.apiKey) return null;

    const params = new URLSearchParams({
      at: `${point.latitude},${point.longitude}`,
      limit: "1",
      apiKey: this.apiKey,
    });
    const url = `https://revgeocode.search.hereapi.com/v1/revgeocode?${params.toString()}`;

    const json = await this.fetchJson(url, "reverseGeocode");
    if (!json) return null;

    const body = json as {
      items?: Array<{
        position?: { lat?: number; lng?: number };
        address?: {
          street?: string;
          houseNumber?: string;
          city?: string;
          county?: string;
          state?: string;
          postalCode?: string;
          countryName?: string;
        };
      }>;
    };

    const item = body.items?.[0];
    const position = item?.position;
    if (!item || !position || typeof position.lat !== "number" || typeof position.lng !== "number") return null;

    const city = item.address?.city;
    if (!city) return null;

    const address: FullAddress = {
      line1: [item.address?.street, item.address?.houseNumber].filter(Boolean).join(" ") || undefined,
      city,
      province: item.address?.state ?? item.address?.county ?? null,
      postalCode: item.address?.postalCode ?? null,
      country: item.address?.countryName ?? null,
    };

    return { address, point: { latitude: position.lat, longitude: position.lng } };
  }
}
