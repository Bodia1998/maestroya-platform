import "server-only";

import type { CityGeocodeQuery, FullAddress, ReverseGeocodeResult } from "@/domain/repositories/geocoding-provider";
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

  /**
   * Module 42 — Geocoding & Maps. Nominatim's reverse endpoint
   * (https://nominatim.org/release-docs/latest/api/Reverse/) — the same
   * zero-API-key vendor `geocode()` already uses, so reverse geocoding is
   * reachable with zero configuration exactly like forward geocoding is.
   * Subject to the same ~1 request/second usage policy `geocode()`'s own
   * doc comment already notes, which is why this is always used behind
   * `CachedGeocodingProvider` (see the factory).
   */
  override async reverseGeocode(point: GeoPoint): Promise<ReverseGeocodeResult | null> {
    const params = new URLSearchParams({
      lat: String(point.latitude),
      lon: String(point.longitude),
      format: "json",
      addressdetails: "1",
    });
    const url = `https://nominatim.openstreetmap.org/reverse?${params.toString()}`;

    const json = await this.fetchJson(url, "reverseGeocode");
    if (!json) return null;

    const body = json as {
      lat?: string;
      lon?: string;
      address?: {
        road?: string;
        house_number?: string;
        city?: string;
        town?: string;
        village?: string;
        municipality?: string;
        state?: string;
        province?: string;
        postcode?: string;
        country?: string;
        country_code?: string;
      };
    };

    const city = body.address?.city ?? body.address?.town ?? body.address?.village ?? body.address?.municipality;
    if (!city) return null;

    const latitude = body.lat ? Number.parseFloat(body.lat) : point.latitude;
    const longitude = body.lon ? Number.parseFloat(body.lon) : point.longitude;
    if (Number.isNaN(latitude) || Number.isNaN(longitude)) return null;

    const address: FullAddress = {
      line1: [body.address?.road, body.address?.house_number].filter(Boolean).join(" ") || undefined,
      city,
      province: body.address?.state ?? body.address?.province ?? null,
      postalCode: body.address?.postcode ?? null,
      country: body.address?.country ?? null,
    };

    return { address, point: { latitude, longitude } };
  }
}
