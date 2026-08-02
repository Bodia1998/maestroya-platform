import "server-only";

import type { CityGeocodeQuery, CitySuggestion, GeocodingProvider, ReverseGeocodeResult } from "@/domain/repositories/geocoding-provider";
import { GeocodingNotImplementedError } from "@/domain/repositories/geocoding-provider";
import type { GeoPoint } from "@/domain/services/geo-distance";
import { FetchGeocodingHttpClient } from "@/infrastructure/geocoding/geocoding-http-client";
import type { GeocodingHttpClient } from "@/infrastructure/geocoding/geocoding-http-client";
import { logger } from "@/infrastructure/observability/logger";

/**
 * Module 27 — Spain Location Services hardening.
 *
 * Replaces the previous `HttpGeocodingProvider` (which mixed the HTTP
 * transport directly into the provider base class) with a clean
 * three-layer split:
 *
 *   BaseGeocodingProvider (this file — provider/business logic:
 *     request building, response parsing, error handling)
 *     ↓ delegates the actual network call to
 *   GeocodingHttpClient (geocoding-http-client.ts — transport)
 *     ↓ default implementation
 *   FetchGeocodingHttpClient (plain fetch + timeout)
 *     ↓ extended by
 *   MapboxGeocodingProvider / GoogleGeocodingProvider /
 *   HereGeocodingProvider / OpenStreetMapGeocodingProvider
 *
 * This is what makes "replace fetch with an official SDK later without
 * rewriting business logic" true: a future `MapboxSdkGeocodingProvider`
 * could inject a different `GeocodingHttpClient` (or bypass this base
 * class's `geocode()` entirely and call the SDK directly inside its own
 * `buildRequestUrl`/`parseResponse` overrides) without any change to how
 * errors are caught, logged, and degraded to `null` — that behavior lives
 * here, once, not duplicated per vendor.
 *
 * Still "never throw, never hang" for `geocode()` — the same guarantee
 * `HttpGeocodingProvider` provided — plus default, safe implementations of
 * `GeocodingProvider`'s optional `reverseGeocode`/`searchCities` seam
 * (Module 27, item 3): every subclass gets a controlled
 * `GeocodingNotImplementedError` for free via `notImplemented()`, rather
 * than each vendor provider needing to remember to throw one consistently
 * if/when it doesn't implement a capability yet.
 */
export abstract class BaseGeocodingProvider implements GeocodingProvider {
  /** Short, log-friendly vendor name — e.g. "mapbox", "google", "here", "osm". */
  protected abstract readonly providerName: string;

  constructor(private readonly httpClient: GeocodingHttpClient = new FetchGeocodingHttpClient()) {}

  async geocode(query: CityGeocodeQuery): Promise<GeoPoint | null> {
    let url: string | null;
    try {
      url = this.buildRequestUrl(query);
    } catch (error) {
      logger.error("geocoding_provider_request_build_failed", { provider: this.providerName, error });
      return null;
    }

    // No API key configured (or the subclass otherwise declines this
    // query) — a configuration gap, not a transient failure, but it still
    // must never throw. `createGeocodingProvider()` is expected to catch
    // the missing-key case earlier and fall back to
    // `StaticCityGeocodingProvider` instead of constructing this provider
    // at all; this is a last-resort safety net if that's ever bypassed.
    if (!url) {
      logger.warn("geocoding_provider_not_configured", { provider: this.providerName });
      return null;
    }

    try {
      const response = await this.httpClient.get(url, this.requestInit());
      if (!response.ok) {
        logger.warn("geocoding_provider_http_error", {
          provider: this.providerName,
          status: response.status,
        });
        return null;
      }

      const json: unknown = await response.json();
      return this.parseResponse(json);
    } catch (error) {
      // Network failure, timeout/abort, or malformed JSON — every one of
      // these degrades to "no coordinates available" rather than
      // propagating, so onboarding/Service Request creation continue
      // gracefully exactly as they already do for an unknown city today.
      logger.error("geocoding_provider_failed", { provider: this.providerName, error });
      return null;
    }
  }

  /**
   * Default `reverseGeocode`/`searchCities`: neither is implemented by any
   * provider in this codebase yet (no vendor call was built without a real
   * API key to exercise it against — see the module doc). Subclasses that
   * do implement one override it directly; this base class exists so
   * every current and future provider has *some* well-defined,
   * consistent behavior for the other, unimplemented one, rather than a
   * silent `undefined` or an ad-hoc error shape per vendor.
   */
  async reverseGeocode(_point: GeoPoint): Promise<ReverseGeocodeResult | null> {
    return this.notImplemented("reverseGeocode");
  }

  async searchCities(_partialQuery: string, _province?: string | null): Promise<CitySuggestion[]> {
    return this.notImplemented("searchCities");
  }

  /**
   * Throws a controlled `GeocodingNotImplementedError` — never a bare
   * `Error` or a silent empty result for a capability that was actually
   * requested — so a caller reaching this can distinguish "not built yet"
   * from every other failure mode `geocode()` already degrades to `null`.
   */
  protected notImplemented(feature: string): never {
    throw new GeocodingNotImplementedError(this.providerName, feature);
  }

  /** Extra request options (e.g. headers) a subclass needs — OSM's Nominatim `User-Agent`, for example. */
  protected requestInit(): RequestInit | undefined {
    return undefined;
  }

  /** Builds the vendor request URL, or `null` when this provider isn't usable (e.g. no API key). */
  protected abstract buildRequestUrl(query: CityGeocodeQuery): string | null;

  /** Parses the vendor's raw JSON response into a `GeoPoint`, or `null` for "no result." */
  protected abstract parseResponse(json: unknown): GeoPoint | null;
}
