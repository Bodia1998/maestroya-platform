import { describe, expect, it } from "vitest";

import { StaticCityGeocodingProvider } from "@/infrastructure/geocoding/static-city-geocoding-provider";

/**
 * Maps & Geolocation module (Module 20) — the default, network-free
 * `GeocodingProvider` implementation. See the provider's own doc comment
 * for why this is a small static lookup table, not a real geocoding API.
 */
describe("StaticCityGeocodingProvider", () => {
  const provider = new StaticCityGeocodingProvider();

  it("resolves a known city to its approximate centroid", async () => {
    const point = await provider.geocode({ city: "Madrid" });
    expect(point).not.toBeNull();
    expect(point!.latitude).toBeCloseTo(40.4168, 1);
    expect(point!.longitude).toBeCloseTo(-3.7038, 1);
  });

  it("is case-insensitive", async () => {
    const lower = await provider.geocode({ city: "madrid" });
    const upper = await provider.geocode({ city: "MADRID" });
    expect(lower).toEqual(upper);
  });

  it("is accent-insensitive", async () => {
    const withAccent = await provider.geocode({ city: "Málaga" });
    const withoutAccent = await provider.geocode({ city: "Malaga" });
    expect(withAccent).toEqual(withoutAccent);
    expect(withAccent).not.toBeNull();
  });

  it("tolerates surrounding whitespace", async () => {
    const point = await provider.geocode({ city: "  Valencia  " });
    expect(point).not.toBeNull();
  });

  it("returns null for an unknown city rather than throwing", async () => {
    await expect(provider.geocode({ city: "Not A Real City Name 12345" })).resolves.toBeNull();
  });

  it("is deterministic", async () => {
    const first = await provider.geocode({ city: "Barcelona" });
    const second = await provider.geocode({ city: "Barcelona" });
    expect(first).toEqual(second);
  });

  it("accepts an optional province without erroring for an unambiguous city", async () => {
    const point = await provider.geocode({ city: "Gandia", province: "Valencia" });
    expect(point).not.toBeNull();
  });
});
