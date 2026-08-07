import "server-only";

import type { CityGeocodeQuery, GeocodingProvider, ReverseGeocodeResult } from "@/domain/repositories/geocoding-provider";
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

interface ReverseCacheEntry {
  value: ReverseGeocodeResult | null;
  expiresAt: number;
}

const DEFAULT_TTL_MS = 24 * 60 * 60 * 1000; // 24 hours — city centroids don't move.

// ~11m precision at the equator — coarser than this would risk merging two
// genuinely different reverse-geocode results (different street, same
// cache entry); finer would defeat caching entirely for a "use my current
// location" flow, where the browser's own GPS jitter changes the last few
// decimal places between calls at the same physical spot.
const REVERSE_CACHE_COORDINATE_PRECISION = 4;

export class CachedGeocodingProvider implements GeocodingProvider {
  private readonly cache = new Map<string, CacheEntry>();
  private readonly reverseCache = new Map<string, ReverseCacheEntry>();

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

  /**
   * Module 42 — Geocoding & Maps: same caching decorator, extended to
   * `reverseGeocode`. A separate cache/TTL map from `geocode()`'s own —
   * different key shape (rounded coordinate pair vs. normalized city
   * text) and different value type (`ReverseGeocodeResult | null` vs.
   * `GeoPoint | null`) — but identical caching semantics (hits and misses
   * both cached, same default TTL). Returns `null` immediately, without
   * caching anything, when the wrapped provider doesn't implement
   * `reverseGeocode` at all — there is nothing worth remembering about an
   * unsupported capability.
   */
  async reverseGeocode(point: GeoPoint): Promise<ReverseGeocodeResult | null> {
    if (!this.inner.reverseGeocode) return null;

    const key = this.reverseCacheKey(point);
    const cached = this.reverseCache.get(key);
    const now = Date.now();

    if (cached && cached.expiresAt > now) {
      return cached.value;
    }

    const value = await this.inner.reverseGeocode(point);
    this.reverseCache.set(key, { value, expiresAt: now + this.ttlMs });
    return value;
  }

  /** Exposed for tests only. */
  size(): number {
    return this.cache.size;
  }

  /** Exposed for tests only. */
  reverseSize(): number {
    return this.reverseCache.size;
  }

  private reverseCacheKey(point: GeoPoint): string {
    return `${point.latitude.toFixed(REVERSE_CACHE_COORDINATE_PRECISION)},${point.longitude.toFixed(REVERSE_CACHE_COORDINATE_PRECISION)}`;
  }

  private cacheKey(query: CityGeocodeQuery): string {
    const city = normalizeLocationText(query.city);
    const province = query.province ? normalizeLocationText(query.province) : "";
    const country = query.country ? normalizeLocationText(query.country) : "";
    return `${city}|${province}|${country}`;
  }
}
