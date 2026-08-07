import type { GeocodingProvider, ReverseGeocodeResult } from "@/domain/repositories/geocoding-provider";
import type { ReverseGeocodeInput } from "@/application/dto/geolocation.dto";

/**
 * Module 42 — Geocoding & Maps.
 *
 * Thin orchestration around `GeocodingProvider.reverseGeocode`, mirroring
 * exactly `GeocodeCityUseCase`'s own "no authorization/ownership concerns
 * of its own" reasoning — resolving "what address is at this point" is not
 * account-scoped sensitive data. Intended for the interactive map UI (click
 * a point on the map / confirm a browser-geolocated point) built by this
 * module, and for any future profile-editing flow that wants to preview an
 * address before saving coordinates.
 *
 * Returns `null` whenever the configured provider doesn't support reverse
 * geocoding, the point resolves to nothing, or the request fails —
 * `SafeGeocodingProvider`/`CachedGeocodingProvider` (which
 * `createGeocodingProvider()` always wraps every provider in) already
 * collapse every one of those cases to `null`, so this use case never needs
 * to catch `GeocodingNotImplementedError` itself.
 */
export class ReverseGeocodeUseCase {
  constructor(private readonly geocoding: GeocodingProvider) {}

  async execute(input: ReverseGeocodeInput): Promise<ReverseGeocodeResult | null> {
    if (!this.geocoding.reverseGeocode) return null;
    return this.geocoding.reverseGeocode({ latitude: input.latitude, longitude: input.longitude });
  }
}
