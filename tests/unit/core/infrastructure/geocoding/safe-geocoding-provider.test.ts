import { describe, expect, it, vi } from "vitest";

import { SafeGeocodingProvider } from "@/infrastructure/geocoding/safe-geocoding-provider";
import type { CityGeocodeQuery, GeocodingProvider } from "@/domain/repositories/geocoding-provider";

/** Module 27 — Spain Location Services. */
class ThrowingProvider implements GeocodingProvider {
  async geocode(_query: CityGeocodeQuery): Promise<never> {
    throw new Error("simulated vendor outage");
  }
}

class WorkingProvider implements GeocodingProvider {
  async geocode(query: CityGeocodeQuery) {
    return query.city === "Madrid" ? { latitude: 40.4168, longitude: -3.7038 } : null;
  }
}

describe("SafeGeocodingProvider", () => {
  it("never throws — converts a wrapped provider's rejection into null", async () => {
    const safe = new SafeGeocodingProvider(new ThrowingProvider(), "test-provider");

    await expect(safe.geocode({ city: "Madrid" })).resolves.toBeNull();
  });

  it("logs the failure rather than swallowing it silently", async () => {
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const safe = new SafeGeocodingProvider(new ThrowingProvider(), "test-provider");

    await safe.geocode({ city: "Madrid" });

    expect(errorSpy).toHaveBeenCalled();
    errorSpy.mockRestore();
  });

  it("passes through a working provider's result unchanged", async () => {
    const safe = new SafeGeocodingProvider(new WorkingProvider(), "test-provider");

    await expect(safe.geocode({ city: "Madrid" })).resolves.toEqual({
      latitude: 40.4168,
      longitude: -3.7038,
    });
    await expect(safe.geocode({ city: "Nowhere" })).resolves.toBeNull();
  });
});
