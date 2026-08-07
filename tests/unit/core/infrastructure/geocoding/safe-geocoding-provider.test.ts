import { describe, expect, it, vi } from "vitest";

import { SafeGeocodingProvider } from "@/infrastructure/geocoding/safe-geocoding-provider";
import type { CityGeocodeQuery, GeocodingProvider, ReverseGeocodeResult } from "@/domain/repositories/geocoding-provider";
import type { GeoPoint } from "@/domain/services/geo-distance";

/** Module 27 — Spain Location Services. */
class ThrowingProvider implements GeocodingProvider {
  async geocode(_query: CityGeocodeQuery): Promise<never> {
    throw new Error("simulated vendor outage");
  }

  async reverseGeocode(_point: GeoPoint): Promise<never> {
    throw new Error("simulated vendor outage");
  }
}

class WorkingProvider implements GeocodingProvider {
  async geocode(query: CityGeocodeQuery) {
    return query.city === "Madrid" ? { latitude: 40.4168, longitude: -3.7038 } : null;
  }

  async reverseGeocode(point: GeoPoint): Promise<ReverseGeocodeResult | null> {
    if (point.latitude !== 40.4168) return null;
    return { address: { city: "Madrid" }, point };
  }
}

/** Module 42 — Geocoding & Maps: a provider that never declares `reverseGeocode` at all
 *  (e.g. `StaticCityGeocodingProvider`), the case `SafeGeocodingProvider.reverseGeocode`
 *  must degrade gracefully for. */
class GeocodeOnlyProvider implements GeocodingProvider {
  async geocode(_query: CityGeocodeQuery) {
    return null;
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

  /** Module 42 — Geocoding & Maps. */
  describe("reverseGeocode", () => {
    it("never throws — converts a wrapped provider's rejection into null", async () => {
      const safe = new SafeGeocodingProvider(new ThrowingProvider(), "test-provider");

      await expect(safe.reverseGeocode({ latitude: 40.4168, longitude: -3.7038 })).resolves.toBeNull();
    });

    it("returns null without throwing when the wrapped provider doesn't implement reverseGeocode at all", async () => {
      const safe = new SafeGeocodingProvider(new GeocodeOnlyProvider(), "test-provider");

      await expect(safe.reverseGeocode({ latitude: 40.4168, longitude: -3.7038 })).resolves.toBeNull();
    });

    it("passes through a working provider's result unchanged", async () => {
      const safe = new SafeGeocodingProvider(new WorkingProvider(), "test-provider");
      const point = { latitude: 40.4168, longitude: -3.7038 };

      await expect(safe.reverseGeocode(point)).resolves.toEqual({ address: { city: "Madrid" }, point });
      await expect(safe.reverseGeocode({ latitude: 0, longitude: 0 })).resolves.toBeNull();
    });

    it("logs the failure rather than swallowing it silently", async () => {
      const errorSpy = vi.spyOn(console, "error").mockImplementation(() => undefined);
      const safe = new SafeGeocodingProvider(new ThrowingProvider(), "test-provider");

      await safe.reverseGeocode({ latitude: 40.4168, longitude: -3.7038 });

      expect(errorSpy).toHaveBeenCalled();
      errorSpy.mockRestore();
    });
  });
});
