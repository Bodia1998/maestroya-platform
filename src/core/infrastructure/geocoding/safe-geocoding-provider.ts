import "server-only";

import type { CityGeocodeQuery, GeocodingProvider } from "@/domain/repositories/geocoding-provider";
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
}
