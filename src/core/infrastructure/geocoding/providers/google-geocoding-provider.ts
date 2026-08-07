import "server-only";

import type { CityGeocodeQuery, FullAddress, ReverseGeocodeResult } from "@/domain/repositories/geocoding-provider";
import type { GeoPoint } from "@/domain/services/geo-distance";
import { BaseGeocodingProvider } from "@/infrastructure/geocoding/base-geocoding-provider";
import type { GeocodingHttpClient } from "@/infrastructure/geocoding/geocoding-http-client";

type GoogleAddressComponent = { long_name?: string; types?: string[] };

function findComponent(components: GoogleAddressComponent[] | undefined, type: string): string | undefined {
  return components?.find((component) => component.types?.includes(type))?.long_name;
}

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

  /**
   * Module 42 — Geocoding & Maps. The same Geocoding API endpoint
   * `geocode()` uses, called with `latlng=` instead of `address=`
   * (https://developers.google.com/maps/documentation/geocoding/requests-reverse-geocoding).
   * Only reachable when `GOOGLE_GEOCODING_API_KEY` is configured — same
   * precondition as `geocode()`.
   */
  override async reverseGeocode(point: GeoPoint): Promise<ReverseGeocodeResult | null> {
    if (!this.apiKey) return null;

    const params = new URLSearchParams({
      latlng: `${point.latitude},${point.longitude}`,
      result_type: "street_address|locality|postal_code",
      key: this.apiKey,
    });
    const url = `https://maps.googleapis.com/maps/api/geocode/json?${params.toString()}`;

    const json = await this.fetchJson(url, "reverseGeocode");
    if (!json) return null;

    const body = json as {
      status?: string;
      results?: Array<{
        address_components?: GoogleAddressComponent[];
        geometry?: { location?: { lat?: number; lng?: number } };
      }>;
    };
    if (body.status !== "OK") return null;

    const first = body.results?.[0];
    const location = first?.geometry?.location;
    if (!first || !location || typeof location.lat !== "number" || typeof location.lng !== "number") return null;

    const components = first.address_components;
    const city = findComponent(components, "locality") ?? findComponent(components, "postal_town");
    if (!city) return null;

    const address: FullAddress = {
      line1: [findComponent(components, "route"), findComponent(components, "street_number")]
        .filter(Boolean)
        .join(" ") || undefined,
      city,
      province: findComponent(components, "administrative_area_level_2") ?? findComponent(components, "administrative_area_level_1") ?? null,
      postalCode: findComponent(components, "postal_code") ?? null,
      country: findComponent(components, "country") ?? null,
    };

    return { address, point: { latitude: location.lat, longitude: location.lng } };
  }
}
