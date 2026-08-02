import "server-only";

import type { GeocodingProvider } from "@/domain/repositories/geocoding-provider";
import { CachedGeocodingProvider } from "@/infrastructure/geocoding/cached-geocoding-provider";
import { GoogleGeocodingProvider } from "@/infrastructure/geocoding/providers/google-geocoding-provider";
import { HereGeocodingProvider } from "@/infrastructure/geocoding/providers/here-geocoding-provider";
import { MapboxGeocodingProvider } from "@/infrastructure/geocoding/providers/mapbox-geocoding-provider";
import { OpenStreetMapGeocodingProvider } from "@/infrastructure/geocoding/providers/openstreetmap-geocoding-provider";
import { SafeGeocodingProvider } from "@/infrastructure/geocoding/safe-geocoding-provider";
import { StaticCityGeocodingProvider } from "@/infrastructure/geocoding/static-city-geocoding-provider";
import { env } from "@/infrastructure/config/env";
import { logger } from "@/infrastructure/observability/logger";

/**
 * Module 27 — Spain Location Services — the provider factory/composition
 * seam Module 20 documented as its own "Known Limitations #1": swap in a
 * real geocoding vendor later purely via configuration, with **no code
 * change** anywhere that consumes a `GeocodingProvider`
 * (`GeocodeCityUseCase`, `SearchDirectoryUseCase`,
 * `CompleteProfessionalOnboardingUseCase`, `CreateServiceRequestUseCase`,
 * `UpdateServiceRequestUseCase`) — only `.env`/`.env.local` changes.
 *
 * Resolution rules — the overriding invariant across every one of them is
 * "the application must never accidentally call a real external API":
 *
 *   1. `GEOCODING_PROVIDER=STATIC` — the explicit default (see `env.ts`;
 *      unset or invalid also lands here via `.catch("STATIC")`) —
 *      constructs `StaticCityGeocodingProvider` and stops. No HTTP client,
 *      no vendor class, is ever instantiated on this path.
 *   2. `GEOCODING_PROVIDER` set to `MAPBOX`/`GOOGLE`/`HERE` but the
 *      matching `*_API_KEY` is empty → logs a warning
 *      (`geocoding_provider_missing_api_key`) and falls back to
 *      `StaticCityGeocodingProvider` rather than failing startup or
 *      throwing at request time. This is what makes "prepare the project
 *      so an API can be connected in under 5 minutes later" true: setting
 *      the two environment variables is the entire integration step, and
 *      forgetting the key degrades safely instead of breaking the app or
 *      silently making a doomed, key-less request.
 *   3. `GEOCODING_PROVIDER=OSM` needs no key (Nominatim) and is
 *      constructed directly — this is the one real, network-backed
 *      provider reachable with zero configuration, so it's never the
 *      *default*, only an explicit opt-in.
 *   4. Any other value reaching this function (there shouldn't be one —
 *      `env.ts`'s `z.enum(...).catch("STATIC")` already normalizes
 *      anything invalid before this module ever sees it) still falls
 *      through to `StaticCityGeocodingProvider` via the `default` case
 *      below — defense in depth, not the primary safety mechanism.
 *   5. Whatever provider is chosen is always wrapped in
 *      `SafeGeocodingProvider` (never throws/hangs the caller) and then
 *      `CachedGeocodingProvider` (avoids repeat outbound requests for the
 *      same city) — see each decorator's own doc comment. This applies
 *      uniformly, including to the static fallback, so callers get the
 *      exact same `GeocodingProvider` contract no matter which branch
 *      below was taken.
 */
function buildBaseProvider(): { provider: GeocodingProvider; name: string } {
  switch (env.GEOCODING_PROVIDER) {
    case "STATIC": {
      return { provider: new StaticCityGeocodingProvider(), name: "static" };
    }
    case "MAPBOX": {
      if (!env.MAPBOX_API_KEY) {
        logger.warn("geocoding_provider_missing_api_key", { provider: "mapbox" });
        break;
      }
      return { provider: new MapboxGeocodingProvider(env.MAPBOX_API_KEY), name: "mapbox" };
    }
    case "GOOGLE": {
      if (!env.GOOGLE_GEOCODING_API_KEY) {
        logger.warn("geocoding_provider_missing_api_key", { provider: "google" });
        break;
      }
      return { provider: new GoogleGeocodingProvider(env.GOOGLE_GEOCODING_API_KEY), name: "google" };
    }
    case "HERE": {
      if (!env.HERE_API_KEY) {
        logger.warn("geocoding_provider_missing_api_key", { provider: "here" });
        break;
      }
      return { provider: new HereGeocodingProvider(env.HERE_API_KEY), name: "here" };
    }
    case "OSM": {
      return { provider: new OpenStreetMapGeocodingProvider(), name: "osm" };
    }
    default:
      break;
  }

  return { provider: new StaticCityGeocodingProvider(), name: "static" };
}

export function createGeocodingProvider(): GeocodingProvider {
  const { provider, name } = buildBaseProvider();
  logger.info("geocoding_provider_selected", { provider: name });

  return new CachedGeocodingProvider(new SafeGeocodingProvider(provider, name));
}
