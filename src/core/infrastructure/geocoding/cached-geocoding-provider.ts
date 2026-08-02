import "server-only";

import type { CityGeocodeQuery, GeocodingProvider } from "@/domain/repositories/geocoding-provider";
import type { GeoPoint } from "@/domain/services/geo-distance";
import { normalizeLocationText } from "@/infrastructure/geocoding/normalize-location-text";

/**
 * Module 27 — Spain Location Services.
 *
 * `GeocodingProvider` decorator adding a simple in-memory, TTL-based cache
 * in front of any wrapped provider. City/province combinations repeat
 * constantly (many professionals/customers share the same handful of
 * cities), and every real vendor provider is a metered, rate-limited,
 * paid-per-request API — this is the seam that stops repeated lookups of
 * the same city from becoming repeated outbound API calls.
 *
 * Deliberately simple, matching this module's "the implementation may
 * initially be simple" scope: a single process-local `Map`, no eviction
 * policy beyond TTL expiry, no cross-instance/shared cache (Redis or
 * similar). That is a real limitation on a multi-instance deployment
 * (each instance warms its own cache independently) but never a
 * correctness problem — a cache miss just falls through to the wrapped
 * provider exactly as if no cache existed. `REDIS_URL` (see `env.ts`,
 * Module 25) is the ready, already-validated place a future shared cache
 * would read its connection string from, without this provider's
 * `GeocodingProvider` contract changing at all.
 *
 * Caches `null` results too (a "this city isn't recognized" answer is
 * just as expensive to re-fetch from a real API as a hit), with the same
 * TTL — a city that starts resolving after a vendor-side data update
 * simply takes up to `ttlMs` to reflect that, an acceptable trade-off at
 * this cache's scope.
 *
 * **Cache key normalization** (Module 27 hardening): keys are built with
 * `normalizeLocationText` — the same trim/collapse-whitespace/lowercase/
 * strip-accents normalization `StaticCityGeocodingProvider` already uses
 * for its own table lookup. `"Valencia"`, `"VALENCIA"`, `"valencia"`,
 * `" València "`, and `"valéncia"` all produce the exact same cache key,
 * so the same real-world place is never split across multiple cache
 * entries just because a caller (or two different callers) spelled/cased/
 * spaced it differently.
 */
interface CacheEntry {
  value: GeoPoint | null;
  expiresAt: number;
}

const DEFAULT_TTL_MS = 24 * 60 * 60 * 1000; // 24 hours — city centroids don't move.

export class CachedGeocodingProvider implements GeocodingProvider {
  private readonly cache = new Map<string, CacheEntry>();

  constructor(
    private readonly inner: GeocodingProvider,
    private readonly ttlMs: number = DEFAULT_TTL_MS,
  ) {}

  async geocode(query: CityGeocodeQuery): Promise<GeoPoint | null> {
    const key = this.cacheKey(query);
    const cached = this.cache.get(key);
    const now = Date.now();

    if (cached && cached.expiresAt > now) {
      return cached.value;
    }

    const value = await this.inner.geocode(query);
    this.cache.set(key, { value, expiresAt: now + this.ttlMs });
    return value;
  }

  /** Exposed for tests only. */
  size(): number {
    return this.cache.size;
  }

  private cacheKey(query: CityGeocodeQuery): string {
    const city = normalizeLocationText(query.city);
    const province = query.province ? normalizeLocationText(query.province) : "";
    const country = query.country ? normalizeLocationText(query.country) : "";
    return `${city}|${province}|${country}`;
  }
}
