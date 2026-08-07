import { describe, expect, it } from "vitest";

import { GeocodingNotImplementedError } from "@/domain/repositories/geocoding-provider";
import type { CityGeocodeQuery } from "@/domain/repositories/geocoding-provider";
import { BaseGeocodingProvider } from "@/infrastructure/geocoding/base-geocoding-provider";
import type { GeocodingHttpClient, GeocodingHttpResponse } from "@/infrastructure/geocoding/geocoding-http-client";
import type { GeoPoint } from "@/domain/services/geo-distance";
import type { ReverseGeocodeResult } from "@/domain/repositories/geocoding-provider";

/**
 * Module 27 — Spain Location Services hardening.
 *
 * Exercises `BaseGeocodingProvider` directly through a minimal test
 * subclass — proves the HTTP-transport/provider-logic split (item 4) by
 * injecting a fake `GeocodingHttpClient` instead of stubbing global
 * `fetch`, and proves the "not implemented" seam (item 3) without needing
 * a real vendor provider.
 */
class FakeHttpClient implements GeocodingHttpClient {
  calls: Array<{ url: string; init?: RequestInit }> = [];
  response: GeocodingHttpResponse = { ok: true, status: 200, json: async () => ({ lat: 1, lng: 2 }) };

  async get(url: string, init?: RequestInit): Promise<GeocodingHttpResponse> {
    this.calls.push({ url, init });
    return this.response;
  }
}

class TestProvider extends BaseGeocodingProvider {
  protected readonly providerName = "test-vendor";

  protected buildRequestUrl(query: CityGeocodeQuery): string | null {
    if (!query.city) return null;
    return `https://example.test/geocode?city=${encodeURIComponent(query.city)}`;
  }

  protected override requestInit(): RequestInit {
    return { headers: { "X-Test": "1" } };
  }

  protected parseResponse(json: unknown): GeoPoint | null {
    const body = json as { lat?: number; lng?: number };
    if (typeof body.lat !== "number" || typeof body.lng !== "number") return null;
    return { latitude: body.lat, longitude: body.lng };
  }
}

/**
 * Module 42 — Geocoding & Maps: a second test subclass, separate from
 * `TestProvider` above (which must keep the *default*, unimplemented
 * `reverseGeocode` to prove the "not implemented" seam still works),
 * exercising the new shared `fetchJson` helper through a real
 * `reverseGeocode` override — the same pattern every real vendor's
 * `reverseGeocode` override (Mapbox/Google/HERE/OSM) uses.
 */
class ReverseGeocodingTestProvider extends BaseGeocodingProvider {
  protected readonly providerName = "test-vendor";

  protected buildRequestUrl(_query: CityGeocodeQuery): string | null {
    return null;
  }

  protected parseResponse(_json: unknown): GeoPoint | null {
    return null;
  }

  override async reverseGeocode(point: GeoPoint): Promise<ReverseGeocodeResult | null> {
    const json = await this.fetchJson(`https://example.test/reverse?lat=${point.latitude}`, "reverseGeocode");
    if (!json) return null;
    const body = json as { city?: string };
    if (!body.city) return null;
    return { address: { city: body.city }, point };
  }
}

describe("BaseGeocodingProvider", () => {
  it("delegates the network call to the injected GeocodingHttpClient (not global fetch)", async () => {
    const client = new FakeHttpClient();
    const provider = new TestProvider(client);

    const point = await provider.geocode({ city: "Madrid" });

    expect(point).toEqual({ latitude: 1, longitude: 2 });
    expect(client.calls).toHaveLength(1);
    expect(client.calls[0]?.url).toContain("city=Madrid");
  });

  it("passes requestInit() (e.g. custom headers) through to the http client", async () => {
    const client = new FakeHttpClient();
    const provider = new TestProvider(client);

    await provider.geocode({ city: "Madrid" });

    expect((client.calls[0]?.init?.headers as Record<string, string>)["X-Test"]).toBe("1");
  });

  it("returns null (never throws) when buildRequestUrl declines the query", async () => {
    const client = new FakeHttpClient();
    const provider = new TestProvider(client);

    await expect(provider.geocode({ city: "" })).resolves.toBeNull();
    expect(client.calls).toHaveLength(0);
  });

  it("returns null on a non-ok HTTP response", async () => {
    const client = new FakeHttpClient();
    client.response = { ok: false, status: 503, json: async () => ({}) };
    const provider = new TestProvider(client);

    await expect(provider.geocode({ city: "Madrid" })).resolves.toBeNull();
  });

  it("returns null when the http client's get() rejects", async () => {
    const client: GeocodingHttpClient = {
      get: async () => {
        throw new Error("connection reset");
      },
    };
    const provider = new TestProvider(client);

    await expect(provider.geocode({ city: "Madrid" })).resolves.toBeNull();
  });

  it("reverseGeocode/searchCities are unimplemented by default and throw a controlled, named error", async () => {
    const provider = new TestProvider(new FakeHttpClient());

    await expect(provider.reverseGeocode!({ latitude: 40, longitude: -3 })).rejects.toThrow(
      GeocodingNotImplementedError,
    );
    await expect(provider.searchCities!("Val")).rejects.toThrow(GeocodingNotImplementedError);
    await expect(provider.searchCities!("Val")).rejects.toThrow(/test-vendor.*searchCities/);
  });

  /**
   * Module 42 — Geocoding & Maps: `fetchJson` — the shared helper every
   * real vendor's `reverseGeocode` override uses — via
   * `ReverseGeocodingTestProvider`. Mirrors the exact same never-throw
   * coverage `geocode()`'s own tests above already have.
   */
  describe("fetchJson (used by reverseGeocode overrides)", () => {
    it("delegates to the injected GeocodingHttpClient and returns parsed JSON", async () => {
      const client = new FakeHttpClient();
      client.response = { ok: true, status: 200, json: async () => ({ city: "Madrid" }) };
      const provider = new ReverseGeocodingTestProvider(client);

      const result = await provider.reverseGeocode({ latitude: 40.4168, longitude: -3.7038 });

      expect(result).toEqual({ address: { city: "Madrid" }, point: { latitude: 40.4168, longitude: -3.7038 } });
      expect(client.calls[0]?.url).toContain("lat=40.4168");
    });

    it("returns null on a non-ok HTTP response", async () => {
      const client = new FakeHttpClient();
      client.response = { ok: false, status: 503, json: async () => ({}) };
      const provider = new ReverseGeocodingTestProvider(client);

      await expect(provider.reverseGeocode({ latitude: 40.4168, longitude: -3.7038 })).resolves.toBeNull();
    });

    it("returns null when the http client's get() rejects", async () => {
      const client: GeocodingHttpClient = {
        get: async () => {
          throw new Error("connection reset");
        },
      };
      const provider = new ReverseGeocodingTestProvider(client);

      await expect(provider.reverseGeocode({ latitude: 40.4168, longitude: -3.7038 })).resolves.toBeNull();
    });
  });
});
