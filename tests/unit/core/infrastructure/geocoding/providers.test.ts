import { afterEach, describe, expect, it, vi } from "vitest";

import { GoogleGeocodingProvider } from "@/infrastructure/geocoding/providers/google-geocoding-provider";
import { HereGeocodingProvider } from "@/infrastructure/geocoding/providers/here-geocoding-provider";
import { MapboxGeocodingProvider } from "@/infrastructure/geocoding/providers/mapbox-geocoding-provider";
import { OpenStreetMapGeocodingProvider } from "@/infrastructure/geocoding/providers/openstreetmap-geocoding-provider";

/**
 * Module 27 — Spain Location Services.
 *
 * These tests prove each real provider is wired to the actual vendor
 * contract (correct endpoint, correct query params/auth, correct response
 * parsing) using a mocked `fetch` — the "ready to connect in under 5
 * minutes" claim rests on this request/response shape being right today,
 * even though no real API key exists to hit the live services with.
 */
describe("real GeocodingProvider implementations", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("MapboxGeocodingProvider builds a correctly-scoped request and parses [lng, lat] center", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ features: [{ center: [-3.7038, 40.4168] }] }),
    });
    vi.stubGlobal("fetch", fetchMock);

    const provider = new MapboxGeocodingProvider("test-key");
    const point = await provider.geocode({ city: "Madrid" });

    expect(point).toEqual({ latitude: 40.4168, longitude: -3.7038 });
    const [url] = fetchMock.mock.calls[0] as [string];
    expect(url).toContain("api.mapbox.com/geocoding/v5/mapbox.places/");
    expect(url).toContain("access_token=test-key");
    expect(url).toContain("country=es");
  });

  it("MapboxGeocodingProvider returns null (never throws) with no API key", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    const provider = new MapboxGeocodingProvider("");
    await expect(provider.geocode({ city: "Madrid" })).resolves.toBeNull();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("GoogleGeocodingProvider builds a correctly-scoped request and parses lat/lng", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        status: "OK",
        results: [{ geometry: { location: { lat: 40.4168, lng: -3.7038 } } }],
      }),
    });
    vi.stubGlobal("fetch", fetchMock);

    const provider = new GoogleGeocodingProvider("test-key");
    const point = await provider.geocode({ city: "Madrid", province: "Madrid" });

    expect(point).toEqual({ latitude: 40.4168, longitude: -3.7038 });
    const [url] = fetchMock.mock.calls[0] as [string];
    expect(url).toContain("maps.googleapis.com/maps/api/geocode/json");
    expect(url).toContain("key=test-key");
    expect(url).toContain("region=es");
  });

  it("GoogleGeocodingProvider returns null when the vendor reports a non-OK status", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ status: "ZERO_RESULTS", results: [] }),
    });
    vi.stubGlobal("fetch", fetchMock);

    const provider = new GoogleGeocodingProvider("test-key");
    await expect(provider.geocode({ city: "Nowhereville" })).resolves.toBeNull();
  });

  it("HereGeocodingProvider builds a correctly-scoped request and parses lat/lng", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ items: [{ position: { lat: 40.4168, lng: -3.7038 } }] }),
    });
    vi.stubGlobal("fetch", fetchMock);

    const provider = new HereGeocodingProvider("test-key");
    const point = await provider.geocode({ city: "Madrid" });

    expect(point).toEqual({ latitude: 40.4168, longitude: -3.7038 });
    const [url] = fetchMock.mock.calls[0] as [string];
    expect(url).toContain("geocode.search.hereapi.com/v1/geocode");
    expect(url).toContain("apiKey=test-key");
    expect(url).toContain("in=countryCode%3AESP");
  });

  it("OpenStreetMapGeocodingProvider needs no key and parses lat/lon strings", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => [{ lat: "40.4168", lon: "-3.7038" }],
    });
    vi.stubGlobal("fetch", fetchMock);

    const provider = new OpenStreetMapGeocodingProvider();
    const point = await provider.geocode({ city: "Madrid" });

    expect(point).toEqual({ latitude: 40.4168, longitude: -3.7038 });
    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect((init.headers as Record<string, string>)["User-Agent"]).toContain("MaestroYa");
  });

  it("every provider returns null (never throws) on an HTTP error response", async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: false, status: 500 });
    vi.stubGlobal("fetch", fetchMock);

    await expect(new MapboxGeocodingProvider("k").geocode({ city: "Madrid" })).resolves.toBeNull();
    await expect(new GoogleGeocodingProvider("k").geocode({ city: "Madrid" })).resolves.toBeNull();
    await expect(new HereGeocodingProvider("k").geocode({ city: "Madrid" })).resolves.toBeNull();
    await expect(new OpenStreetMapGeocodingProvider().geocode({ city: "Madrid" })).resolves.toBeNull();
  });

  it("every provider returns null (never throws) on a network failure", async () => {
    const fetchMock = vi.fn().mockRejectedValue(new Error("network down"));
    vi.stubGlobal("fetch", fetchMock);

    await expect(new MapboxGeocodingProvider("k").geocode({ city: "Madrid" })).resolves.toBeNull();
    await expect(new GoogleGeocodingProvider("k").geocode({ city: "Madrid" })).resolves.toBeNull();
    await expect(new HereGeocodingProvider("k").geocode({ city: "Madrid" })).resolves.toBeNull();
    await expect(new OpenStreetMapGeocodingProvider().geocode({ city: "Madrid" })).resolves.toBeNull();
  });

  /**
   * Module 42 — Geocoding & Maps: `reverseGeocode` coverage for every real
   * provider, mirroring exactly the same "correct endpoint, correct
   * params, correct parsing, never throws" coverage `geocode()` already
   * has above.
   */
  describe("reverseGeocode", () => {
    it("MapboxGeocodingProvider builds a {lng},{lat} reverse request and parses the response", async () => {
      const fetchMock = vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({
          features: [
            {
              center: [-0.1817, 38.9665],
              text: "Carrer Major",
              address: "12",
              context: [
                { id: "place.123", text: "Gandia" },
                { id: "region.456", text: "Valencia" },
                { id: "postcode.789", text: "46701" },
                { id: "country.012", text: "Spain" },
              ],
            },
          ],
        }),
      });
      vi.stubGlobal("fetch", fetchMock);

      const result = await new MapboxGeocodingProvider("test-key").reverseGeocode({
        latitude: 38.9665,
        longitude: -0.1817,
      });

      expect(result).toEqual({
        address: { line1: "12 Carrer Major", city: "Gandia", province: "Valencia", postalCode: "46701", country: "Spain" },
        point: { latitude: 38.9665, longitude: -0.1817 },
      });
      const [url] = fetchMock.mock.calls[0] as [string];
      expect(url).toContain("api.mapbox.com/geocoding/v5/mapbox.places/-0.1817,38.9665.json");
    });

    it("MapboxGeocodingProvider returns null with no API key, without calling fetch", async () => {
      const fetchMock = vi.fn();
      vi.stubGlobal("fetch", fetchMock);

      await expect(new MapboxGeocodingProvider("").reverseGeocode({ latitude: 38.9665, longitude: -0.1817 })).resolves.toBeNull();
      expect(fetchMock).not.toHaveBeenCalled();
    });

    it("GoogleGeocodingProvider builds a latlng reverse request and parses address components", async () => {
      const fetchMock = vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({
          status: "OK",
          results: [
            {
              geometry: { location: { lat: 40.4168, lng: -3.7038 } },
              address_components: [
                { long_name: "Gran Via", types: ["route"] },
                { long_name: "1", types: ["street_number"] },
                { long_name: "Madrid", types: ["locality"] },
                { long_name: "Madrid", types: ["administrative_area_level_2"] },
                { long_name: "28013", types: ["postal_code"] },
                { long_name: "Spain", types: ["country"] },
              ],
            },
          ],
        }),
      });
      vi.stubGlobal("fetch", fetchMock);

      const result = await new GoogleGeocodingProvider("test-key").reverseGeocode({ latitude: 40.4168, longitude: -3.7038 });

      expect(result).toEqual({
        address: { line1: "Gran Via 1", city: "Madrid", province: "Madrid", postalCode: "28013", country: "Spain" },
        point: { latitude: 40.4168, longitude: -3.7038 },
      });
      const [url] = fetchMock.mock.calls[0] as [string];
      expect(url).toContain("latlng=40.4168%2C-3.7038");
    });

    it("GoogleGeocodingProvider returns null on a non-OK vendor status", async () => {
      const fetchMock = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ status: "ZERO_RESULTS", results: [] }) });
      vi.stubGlobal("fetch", fetchMock);

      await expect(new GoogleGeocodingProvider("test-key").reverseGeocode({ latitude: 0, longitude: 0 })).resolves.toBeNull();
    });

    it("HereGeocodingProvider builds an `at=` reverse request and parses the address", async () => {
      const fetchMock = vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({
          items: [
            {
              position: { lat: 40.4168, lng: -3.7038 },
              address: { street: "Gran Via", houseNumber: "1", city: "Madrid", state: "Madrid", postalCode: "28013", countryName: "Spain" },
            },
          ],
        }),
      });
      vi.stubGlobal("fetch", fetchMock);

      const result = await new HereGeocodingProvider("test-key").reverseGeocode({ latitude: 40.4168, longitude: -3.7038 });

      expect(result).toEqual({
        address: { line1: "Gran Via 1", city: "Madrid", province: "Madrid", postalCode: "28013", country: "Spain" },
        point: { latitude: 40.4168, longitude: -3.7038 },
      });
      const [url] = fetchMock.mock.calls[0] as [string];
      expect(url).toContain("revgeocode.search.hereapi.com/v1/revgeocode");
      expect(url).toContain("at=40.4168%2C-3.7038");
    });

    it("OpenStreetMapGeocodingProvider needs no key and parses the Nominatim reverse response", async () => {
      const fetchMock = vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({
          lat: "38.9665",
          lon: "-0.1817",
          address: { road: "Carrer Major", house_number: "12", city: "Gandia", state: "Valencia", postcode: "46701", country: "Spain" },
        }),
      });
      vi.stubGlobal("fetch", fetchMock);

      const result = await new OpenStreetMapGeocodingProvider().reverseGeocode({ latitude: 38.9665, longitude: -0.1817 });

      expect(result).toEqual({
        address: { line1: "Carrer Major 12", city: "Gandia", province: "Valencia", postalCode: "46701", country: "Spain" },
        point: { latitude: 38.9665, longitude: -0.1817 },
      });
      const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
      expect((init.headers as Record<string, string>)["User-Agent"]).toContain("MaestroYa");
    });

    it("OpenStreetMapGeocodingProvider returns null when no city can be resolved for the point", async () => {
      const fetchMock = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ lat: "0", lon: "0", address: {} }) });
      vi.stubGlobal("fetch", fetchMock);

      await expect(new OpenStreetMapGeocodingProvider().reverseGeocode({ latitude: 0, longitude: 0 })).resolves.toBeNull();
    });

    it("every provider's reverseGeocode returns null (never throws) on an HTTP error response", async () => {
      const fetchMock = vi.fn().mockResolvedValue({ ok: false, status: 500 });
      vi.stubGlobal("fetch", fetchMock);

      const point = { latitude: 40.4168, longitude: -3.7038 };
      await expect(new MapboxGeocodingProvider("k").reverseGeocode(point)).resolves.toBeNull();
      await expect(new GoogleGeocodingProvider("k").reverseGeocode(point)).resolves.toBeNull();
      await expect(new HereGeocodingProvider("k").reverseGeocode(point)).resolves.toBeNull();
      await expect(new OpenStreetMapGeocodingProvider().reverseGeocode(point)).resolves.toBeNull();
    });

    it("every provider's reverseGeocode returns null (never throws) on a network failure", async () => {
      const fetchMock = vi.fn().mockRejectedValue(new Error("network down"));
      vi.stubGlobal("fetch", fetchMock);

      const point = { latitude: 40.4168, longitude: -3.7038 };
      await expect(new MapboxGeocodingProvider("k").reverseGeocode(point)).resolves.toBeNull();
      await expect(new GoogleGeocodingProvider("k").reverseGeocode(point)).resolves.toBeNull();
      await expect(new HereGeocodingProvider("k").reverseGeocode(point)).resolves.toBeNull();
      await expect(new OpenStreetMapGeocodingProvider().reverseGeocode(point)).resolves.toBeNull();
    });
  });
});
