import { describe, expect, it, vi } from "vitest";

import { CachedGeocodingProvider } from "@/infrastructure/geocoding/cached-geocoding-provider";
import type { CityGeocodeQuery, GeocodingProvider, ReverseGeocodeResult } from "@/domain/repositories/geocoding-provider";
import type { GeoPoint } from "@/domain/services/geo-distance";

/** Module 27 — Spain Location Services. */
class CountingProvider implements GeocodingProvider {
  calls = 0;
  reverseCalls = 0;

  async geocode(query: CityGeocodeQuery) {
    this.calls += 1;
    return query.city.toLowerCase() === "madrid" ? { latitude: 40.4168, longitude: -3.7038 } : null;
  }

  async reverseGeocode(point: GeoPoint): Promise<ReverseGeocodeResult | null> {
    this.reverseCalls += 1;
    return point.latitude === 40.4168 ? { address: { city: "Madrid" }, point } : null;
  }
}

/** Module 42 — Geocoding & Maps: a provider without `reverseGeocode` at all. */
class GeocodeOnlyProvider implements GeocodingProvider {
  async geocode(_query: CityGeocodeQuery) {
    return null;
  }
}

describe("CachedGeocodingProvider", () => {
  it("only calls the wrapped provider once for repeated identical queries", async () => {
    const inner = new CountingProvider();
    const cached = new CachedGeocodingProvider(inner);

    const first = await cached.geocode({ city: "Madrid" });
    const second = await cached.geocode({ city: "Madrid" });

    expect(first).toEqual(second);
    expect(inner.calls).toBe(1);
  });

  it("caches null results too, avoiding repeated lookups of unknown cities", async () => {
    const inner = new CountingProvider();
    const cached = new CachedGeocodingProvider(inner);

    await cached.geocode({ city: "Nowhereville" });
    await cached.geocode({ city: "Nowhereville" });

    expect(inner.calls).toBe(1);
  });

  it("treats city/province combinations as distinct cache keys", async () => {
    const inner = new CountingProvider();
    const cached = new CachedGeocodingProvider(inner);

    await cached.geocode({ city: "Madrid" });
    await cached.geocode({ city: "Madrid", province: "Madrid" });

    expect(inner.calls).toBe(2);
  });

  it("is case/whitespace-insensitive for the cache key", async () => {
    const inner = new CountingProvider();
    const cached = new CachedGeocodingProvider(inner);

    await cached.geocode({ city: "Madrid" });
    await cached.geocode({ city: "  MADRID  " });

    expect(inner.calls).toBe(1);
  });

  it("normalizes accents and duplicate spaces so the same city never creates multiple cache entries", async () => {
    const inner = new CountingProvider();
    const cached = new CachedGeocodingProvider(inner);

    // Every one of these must hit the exact same cache entry.
    await cached.geocode({ city: "Valencia" });
    await cached.geocode({ city: "VALENCIA" });
    await cached.geocode({ city: "valencia" });
    await cached.geocode({ city: " València " });
    await cached.geocode({ city: "valéncia" });

    expect(inner.calls).toBe(1);
  });

  it("re-queries the wrapped provider once a cache entry has expired", async () => {
    vi.useFakeTimers();
    try {
      const inner = new CountingProvider();
      const cached = new CachedGeocodingProvider(inner, 1000);

      await cached.geocode({ city: "Madrid" });
      vi.advanceTimersByTime(1500);
      await cached.geocode({ city: "Madrid" });

      expect(inner.calls).toBe(2);
    } finally {
      vi.useRealTimers();
    }
  });

  /** Module 42 — Geocoding & Maps. */
  describe("reverseGeocode", () => {
    it("only calls the wrapped provider once for the same rounded coordinate", async () => {
      const inner = new CountingProvider();
      const cached = new CachedGeocodingProvider(inner);
      const point = { latitude: 40.4168, longitude: -3.7038 };

      const first = await cached.reverseGeocode(point);
      const second = await cached.reverseGeocode(point);

      expect(first).toEqual(second);
      expect(inner.reverseCalls).toBe(1);
      expect(cached.reverseSize()).toBe(1);
    });

    it("caches null results too", async () => {
      const inner = new CountingProvider();
      const cached = new CachedGeocodingProvider(inner);

      await cached.reverseGeocode({ latitude: 0, longitude: 0 });
      await cached.reverseGeocode({ latitude: 0, longitude: 0 });

      expect(inner.reverseCalls).toBe(1);
    });

    it("treats distinct coordinates as distinct cache keys, independent of the geocode() cache", async () => {
      const inner = new CountingProvider();
      const cached = new CachedGeocodingProvider(inner);

      await cached.reverseGeocode({ latitude: 40.4168, longitude: -3.7038 });
      await cached.reverseGeocode({ latitude: 41.3874, longitude: 2.1686 });
      await cached.geocode({ city: "Madrid" });

      expect(inner.reverseCalls).toBe(2);
      expect(inner.calls).toBe(1);
      expect(cached.size()).toBe(1);
      expect(cached.reverseSize()).toBe(2);
    });

    it("returns null without caching or calling through when the wrapped provider has no reverseGeocode", async () => {
      const inner = new GeocodeOnlyProvider();
      const cached = new CachedGeocodingProvider(inner);

      await expect(cached.reverseGeocode({ latitude: 40.4168, longitude: -3.7038 })).resolves.toBeNull();
      expect(cached.reverseSize()).toBe(0);
    });

    it("re-queries the wrapped provider once a reverse cache entry has expired", async () => {
      vi.useFakeTimers();
      try {
        const inner = new CountingProvider();
        const cached = new CachedGeocodingProvider(inner, 1000);
        const point = { latitude: 40.4168, longitude: -3.7038 };

        await cached.reverseGeocode(point);
        vi.advanceTimersByTime(1500);
        await cached.reverseGeocode(point);

        expect(inner.reverseCalls).toBe(2);
      } finally {
        vi.useRealTimers();
      }
    });
  });
});
