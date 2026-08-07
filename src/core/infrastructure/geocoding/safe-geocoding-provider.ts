import "server-only";

import type { CityGeocodeQuery, GeocodingProvider, ReverseGeocodeResult } from "@/domain/repositories/geocoding-provider";
import type { GeoPoint } from "@/domain/services/geo-distance";
import { logger } from "@/infrastructure/observability/logger";

/**
 * Module 27 — Spain Location Services.
 *
 * `GeocodingProvider` decorator: guarantees `geocode()` never throws and
 * never hangs the caller, regardless of what the wrapped provider does.
 * `HttpGeocodingProvider` (the base every real vendor provider extends)
 * already catches its own errors internally, but this decorator is the
 * defense-in-depth layer `createGeocodingProvider()` wraps *every*
 * resolved provider in — including `StaticCityGeocodingProvider` and any
 * future provider that forgets its own try/catch — so "a geocoding
 * provider failure never crashes onboarding or Service Request creation"
 * is an architectural guarantee, not something each provider has to
 * remember to implement correctly on its own.
 */
export class SafeGeocodingProvider implements GeocodingProvider {
  constructor(
    private readonly inner: GeocodingProvider,
    private readonly providerName: string,
  ) {}

  async geocode(query: CityGeocodeQuery): Promise<GeoPoint | null> {
    try {
      return await this.inner.geocode(query);
    } catch (error) {
      // Log and continue gracefully — an unresolved coordinate is always
      // an acceptable, expected outcome for a caller (onboarding/Service
      // Request creation persist the record with null coordinates and
      // move on); a thrown exception here never is.
      logger.error("geocoding_provider_unhandled_error", { provider: this.providerName, error });
      return null;
    }
  }

  /**
   * Module 42 — Geocoding & Maps: same "never throw, never hang" guarantee
   * as `geocode()` above, extended to `reverseGeocode`. Collapses every
   * failure mode — the wrapped provider not implementing it at all
   * (`inner.reverseGeocode` undefined, e.g. `StaticCityGeocodingProvider`),
   * `BaseGeocodingProvider`'s default `GeocodingNotImplementedError`, or a
   * real network/parsing failure — to the same `null` result a caller
   * already treats as "no address available for this point," matching
   * `geocode()`'s own "unknown is not an error" contract. A caller that
   * cares about the distinction talks to an unwrapped provider directly;
   * every caller going through the composed `GeocodingProvider` this
   * factory returns gets the simpler, uniform contract.
   */
  async reverseGeocode(point: GeoPoint): Promise<ReverseGeocodeResult | null> {
    if (!this.inner.reverseGeocode) return null;

    try {
      return await this.inner.reverseGeocode(point);
    } catch (error) {
      logger.error("geocoding_provider_unhandled_error", {
        provider: this.providerName,
        feature: "reverseGeocode",
        error,
      });
      return null;
    }
  }
}
