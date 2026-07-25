import { describe, expect, it } from "vitest";

import { GeocodeCityUseCase } from "@/application/use-cases/geolocation/geocode-city.use-case";
import type { CityGeocodeQuery, GeocodingProvider } from "@/domain/repositories/geocoding-provider";

/** Maps & Geolocation module (Module 20). */
class FakeGeocodingProvider implements GeocodingProvider {
  calls: CityGeocodeQuery[] = [];

  async geocode(query: CityGeocodeQuery) {
    this.calls.push(query);
    return query.city.toLowerCase() === "gandia" ? { latitude: 38.9665, longitude: -0.1817 } : null;
  }
}

describe("GeocodeCityUseCase", () => {
  it("delegates to the injected GeocodingProvider and returns its result", async () => {
    const provider = new FakeGeocodingProvider();
    const useCase = new GeocodeCityUseCase(provider);

    const point = await useCase.execute({ city: "Gandia" });

    expect(point).toEqual({ latitude: 38.9665, longitude: -0.1817 });
    expect(provider.calls).toEqual([{ city: "Gandia", province: undefined }]);
  });

  it("returns null (not an error) for an unknown city", async () => {
    const provider = new FakeGeocodingProvider();
    const useCase = new GeocodeCityUseCase(provider);

    await expect(useCase.execute({ city: "Nowhereville" })).resolves.toBeNull();
  });

  it("passes the province through when supplied", async () => {
    const provider = new FakeGeocodingProvider();
    const useCase = new GeocodeCityUseCase(provider);

    await useCase.execute({ city: "Gandia", province: "Valencia" });

    expect(provider.calls).toEqual([{ city: "Gandia", province: "Valencia" }]);
  });
});
