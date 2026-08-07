import "server-only";

import type { CityGeocodeQuery, FullAddress, ReverseGeocodeResult } from "@/domain/repositories/geocoding-provider";
import type { GeoPoint } from "@/domain/services/geo-distance";
import { BaseGeocodingProvider } from "@/infrastructure/geocoding/base-geocoding-provider";
import type { GeocodingHttpClient } from "@/infrastructure/geocoding/geocoding-http-client";

type MapboxContextEntry = { id?: string; text?: string };

function findContext(context: MapboxContextEntry[] | undefined, prefix: string): string | undefined {
  return context?.find((entry) => entry.id?.startsWith(prefix))?.text;
}

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

  /**
   * Module 42 — Geocoding & Maps. Mapbox's Geocoding API v5 accepts
   * `{longitude},{latitude}.json` as the query segment for reverse lookups
   * (https://docs.mapbox.com/api/search/geocoding/#reverse-geocoding) —
   * same endpoint family `geocode()` already uses, restricted to
   * `types=address,place` so a precise street address is preferred when
   * available.
   */
  override async reverseGeocode(point: GeoPoint): Promise<ReverseGeocodeResult | null> {
    if (!this.apiKey) return null;

    const params = new URLSearchParams({
      access_token: this.apiKey,
      country: "es",
      types: "address,place",
      limit: "1",
    });
    const url = `https://api.mapbox.com/geocoding/v5/mapbox.places/${point.longitude},${point.latitude}.json?${params.toString()}`;

    const json = await this.fetchJson(url, "reverseGeocode");
    if (!json) return null;

    const body = json as {
      features?: Array<{
        center?: [number, number];
        text?: string;
        address?: string;
        context?: MapboxContextEntry[];
      }>;
    };
    const feature = body.features?.[0];
    const center = feature?.center;
    if (!feature || !Array.isArray(center) || center.length !== 2) return null;

    const [longitude, latitude] = center;
    if (typeof latitude !== "number" || typeof longitude !== "number") return null;

    const city = findContext(feature.context, "place");
    if (!city) return null;

    const address: FullAddress = {
      line1: [feature.address, feature.text].filter(Boolean).join(" ") || undefined,
      city,
      province: findContext(feature.context, "region") ?? null,
      postalCode: findContext(feature.context, "postcode") ?? null,
      country: findContext(feature.context, "country") ?? null,
    };

    return { address, point: { latitude, longitude } };
  }
}
