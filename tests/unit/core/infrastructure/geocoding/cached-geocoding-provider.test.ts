import { describe, expect, it, vi } from "vitest";

import { CachedGeocodingProvider } from "@/infrastructure/geocoding/cached-geocoding-provider";
import type { CityGeocodeQuery, GeocodingProvider } from "@/domain/repositories/geocoding-provider";

/** Module 27 — Spain Location Services. */
class CountingProvider implements GeocodingProvider {
  calls = 0;

  async geocode(query: CityGeocodeQuery) {
    this.calls += 1;
    return query.city.toLowerCase() === "madrid" ? { latitude: 40.4168, longitude: -3.7038 } : null;
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
});
