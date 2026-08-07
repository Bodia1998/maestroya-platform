import { describe, expect, it } from "vitest";

import { ReverseGeocodeUseCase } from "@/application/use-cases/geolocation/reverse-geocode.use-case";
import type { CityGeocodeQuery, GeocodingProvider, ReverseGeocodeResult } from "@/domain/repositories/geocoding-provider";
import type { GeoPoint } from "@/domain/services/geo-distance";

/** Module 42 — Geocoding & Maps. */
class FakeGeocodingProvider implements GeocodingProvider {
  calls: GeoPoint[] = [];

  async geocode(_query: CityGeocodeQuery) {
    return null;
  }

  async reverseGeocode(point: GeoPoint): Promise<ReverseGeocodeResult | null> {
    this.calls.push(point);
    return point.latitude === 38.9665
      ? { address: { city: "Gandia", province: "Valencia" }, point }
      : null;
  }
}

/** A provider that never implements reverseGeocode at all — e.g. `StaticCityGeocodingProvider`. */
class GeocodeOnlyProvider implements GeocodingProvider {
  async geocode(_query: CityGeocodeQuery) {
    return null;
  }
}

describe("ReverseGeocodeUseCase", () => {
  it("delegates to the injected GeocodingProvider and returns its result", async () => {
    const provider = new FakeGeocodingProvider();
    const useCase = new ReverseGeocodeUseCase(provider);

    const result = await useCase.execute({ latitude: 38.9665, longitude: -0.1817 });

    expect(result).toEqual({ address: { city: "Gandia", province: "Valencia" }, point: { latitude: 38.9665, longitude: -0.1817 } });
    expect(provider.calls).toEqual([{ latitude: 38.9665, longitude: -0.1817 }]);
  });

  it("returns null (not an error) for a point the provider can't resolve", async () => {
    const provider = new FakeGeocodingProvider();
    const useCase = new ReverseGeocodeUseCase(provider);

    await expect(useCase.execute({ latitude: 0, longitude: 0 })).resolves.toBeNull();
  });

  it("returns null without throwing when the configured provider doesn't support reverse geocoding at all", async () => {
    const useCase = new ReverseGeocodeUseCase(new GeocodeOnlyProvider());

    await expect(useCase.execute({ latitude: 38.9665, longitude: -0.1817 })).resolves.toBeNull();
  });
});
