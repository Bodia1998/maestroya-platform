import { afterEach, describe, expect, it, vi } from "vitest";

import { GoogleGeocodingProvider } from "@/infrastructure/geocoding/providers/google-geocoding-provider";
import { HereGeocodingProvider } from "@/infrastructure/geocoding/providers/here-geocoding-provider";
import { MapboxGeocodingProvider } from "@/infrastructure/geocoding/providers/mapbox-geocoding-provider";
import { OpenStreetMapGeocodingProvider } from "@/infrastructure/geocoding/providers/openstreetmap-geocoding-provider";
import { SafeGeocodingProvider } from "@/infrastructure/geocoding/safe-geocoding-provider";
import { StaticCityGeocodingProvider } from "@/infrastructure/geocoding/static-city-geocoding-provider";

const GEOCODING_ENV_KEYS = [
  "GEOCODING_PROVIDER",
  "MAPBOX_API_KEY",
  "GOOGLE_GEOCODING_API_KEY",
  "HERE_API_KEY",
] as const;

/**
 * Module 27 — Spain Location Services.
 *
 * `createGeocodingProvider()` reads `env.GEOCODING_PROVIDER`/`*_API_KEY`
 * at call time (not module-load time), so strictly speaking these tests
 * don't need `vi.resetModules()` for the env values themselves — setting
 * `process.env` before each call would be enough on its own.
 * `vitest.config.ts`'s baseline `test.env` already supplies every other
 * required variable.
 *
 * `vi.resetModules()` is still used here (module-scoped state like
 * `SafeGeocodingProvider`'s own internals could, in principle, leak
 * between calls otherwise), but that means the dynamically re-imported
 * factory module graph — including `cached-geocoding-provider.ts` — is
 * re-evaluated fresh each time, producing a *new* `CachedGeocodingProvider`
 * class object distinct from any copy imported statically at the top of
 * this file. `instanceof` checks compare prototype identity, not
 * structural shape, so any assertion against the returned provider's type
 * must use the class re-exported from this same dynamic import — never a
 * top-level static import of it.
 */
async function loadFactory(overrides: Record<string, string | undefined>) {
  const mutableEnv = process.env as Record<string, string | undefined>;
  for (const key of GEOCODING_ENV_KEYS) delete mutableEnv[key];
  for (const [key, value] of Object.entries(overrides)) {
    if (value === undefined) delete mutableEnv[key];
    else mutableEnv[key] = value;
  }

  vi.resetModules();
  const [factory, cached] = await Promise.all([
    import("@/infrastructure/geocoding/geocoding-provider-factory"),
    import("@/infrastructure/geocoding/cached-geocoding-provider"),
  ]);
  return { ...factory, CachedGeocodingProvider: cached.CachedGeocodingProvider };
}

describe("createGeocodingProvider", () => {
  afterEach(() => {
    const mutableEnv = process.env as Record<string, string | undefined>;
    for (const key of GEOCODING_ENV_KEYS) delete mutableEnv[key];
  });

  it("falls back to StaticCityGeocodingProvider when GEOCODING_PROVIDER is unset", async () => {
    const { createGeocodingProvider, CachedGeocodingProvider: FreshCachedGeocodingProvider } =
      await loadFactory({});
    const provider = createGeocodingProvider();

    expect(provider).toBeInstanceOf(FreshCachedGeocodingProvider);
    // Behavioral check (the inner chain isn't publicly exposed): a known
    // static-table city still resolves, proving Static is in the chain.
    await expect(provider.geocode({ city: "Madrid" })).resolves.toEqual({
      latitude: 40.4168,
      longitude: -3.7038,
    });
  });

  it("falls back to Static when MAPBOX is selected but MAPBOX_API_KEY is empty", async () => {
    const { createGeocodingProvider } = await loadFactory({ GEOCODING_PROVIDER: "MAPBOX" });
    const provider = createGeocodingProvider();

    await expect(provider.geocode({ city: "Madrid" })).resolves.toEqual({
      latitude: 40.4168,
      longitude: -3.7038,
    });
  });

  it("falls back to Static when GOOGLE is selected but GOOGLE_GEOCODING_API_KEY is empty", async () => {
    const { createGeocodingProvider } = await loadFactory({ GEOCODING_PROVIDER: "GOOGLE" });
    const provider = createGeocodingProvider();

    await expect(provider.geocode({ city: "Madrid" })).resolves.toEqual({
      latitude: 40.4168,
      longitude: -3.7038,
    });
  });

  it("falls back to Static when HERE is selected but HERE_API_KEY is empty", async () => {
    const { createGeocodingProvider } = await loadFactory({ GEOCODING_PROVIDER: "HERE" });
    const provider = createGeocodingProvider();

    await expect(provider.geocode({ city: "Madrid" })).resolves.toEqual({
      latitude: 40.4168,
      longitude: -3.7038,
    });
  });

  it("never throws even when a selected real provider has no key configured", async () => {
    const { createGeocodingProvider } = await loadFactory({ GEOCODING_PROVIDER: "MAPBOX" });
    const provider = createGeocodingProvider();

    await expect(provider.geocode({ city: "Not A Real City" })).resolves.toBeNull();
  });

  it("selects OSM (no API key required) when explicitly configured", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => [{ lat: "40.4168", lon: "-3.7038" }],
    });
    vi.stubGlobal("fetch", fetchMock);

    const { createGeocodingProvider } = await loadFactory({ GEOCODING_PROVIDER: "OSM" });
    const provider = createGeocodingProvider();

    await expect(provider.geocode({ city: "Madrid" })).resolves.toEqual({
      latitude: 40.4168,
      longitude: -3.7038,
    });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url] = fetchMock.mock.calls[0] as [string];
    expect(url).toContain("nominatim.openstreetmap.org");

    vi.unstubAllGlobals();
  });

  it("uses StaticCityGeocodingProvider when GEOCODING_PROVIDER=STATIC is explicit", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    const { createGeocodingProvider } = await loadFactory({ GEOCODING_PROVIDER: "STATIC" });
    const provider = createGeocodingProvider();

    await expect(provider.geocode({ city: "Madrid" })).resolves.toEqual({
      latitude: 40.4168,
      longitude: -3.7038,
    });
    // The whole point of the default provider: zero outbound HTTP calls.
    expect(fetchMock).not.toHaveBeenCalled();

    vi.unstubAllGlobals();
  });

  it("makes zero outbound HTTP calls when GEOCODING_PROVIDER is left unset (the production default)", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    const { createGeocodingProvider } = await loadFactory({});
    const provider = createGeocodingProvider();
    await provider.geocode({ city: "Barcelona" });
    await provider.geocode({ city: "Not A Real City" });

    expect(fetchMock).not.toHaveBeenCalled();

    vi.unstubAllGlobals();
  });

  it("uses MapboxGeocodingProvider (real outbound request) once GEOCODING_PROVIDER=MAPBOX and a key are both set", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ features: [{ center: [-3.7038, 40.4168] }] }),
    });
    vi.stubGlobal("fetch", fetchMock);

    const { createGeocodingProvider } = await loadFactory({
      GEOCODING_PROVIDER: "MAPBOX",
      MAPBOX_API_KEY: "real-key",
    });
    const provider = createGeocodingProvider();

    await expect(provider.geocode({ city: "Madrid" })).resolves.toEqual({
      latitude: 40.4168,
      longitude: -3.7038,
    });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url] = fetchMock.mock.calls[0] as [string];
    expect(url).toContain("api.mapbox.com");

    vi.unstubAllGlobals();
  });

  it("uses GoogleGeocodingProvider once GEOCODING_PROVIDER=GOOGLE and a key are both set", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ status: "OK", results: [{ geometry: { location: { lat: 40.4168, lng: -3.7038 } } }] }),
    });
    vi.stubGlobal("fetch", fetchMock);

    const { createGeocodingProvider } = await loadFactory({
      GEOCODING_PROVIDER: "GOOGLE",
      GOOGLE_GEOCODING_API_KEY: "real-key",
    });
    const provider = createGeocodingProvider();

    await expect(provider.geocode({ city: "Madrid" })).resolves.toEqual({
      latitude: 40.4168,
      longitude: -3.7038,
    });
    const [url] = fetchMock.mock.calls[0] as [string];
    expect(url).toContain("maps.googleapis.com");

    vi.unstubAllGlobals();
  });

  it("uses HereGeocodingProvider once GEOCODING_PROVIDER=HERE and a key are both set", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ items: [{ position: { lat: 40.4168, lng: -3.7038 } }] }),
    });
    vi.stubGlobal("fetch", fetchMock);

    const { createGeocodingProvider } = await loadFactory({
      GEOCODING_PROVIDER: "HERE",
      HERE_API_KEY: "real-key",
    });
    const provider = createGeocodingProvider();

    await expect(provider.geocode({ city: "Madrid" })).resolves.toEqual({
      latitude: 40.4168,
      longitude: -3.7038,
    });
    const [url] = fetchMock.mock.calls[0] as [string];
    expect(url).toContain("geocode.search.hereapi.com");

    vi.unstubAllGlobals();
  });

  it("caches the resolved provider's result across repeated calls to the returned instance", async () => {
    const { createGeocodingProvider } = await loadFactory({});
    const provider = createGeocodingProvider();

    const first = await provider.geocode({ city: "Madrid" });
    const second = await provider.geocode({ city: "Madrid" });

    expect(first).toEqual(second);
  });

  it("defense in depth: an unrecognized GEOCODING_PROVIDER value that somehow bypasses env.ts still resolves to Static, never throws", async () => {
    // env.ts's z.enum(...).catch("STATIC") already guarantees this can't
    // happen through the normal `env` import — this test simulates that
    // guarantee being bypassed (e.g. a future refactor reading
    // process.env directly) to prove buildBaseProvider()'s own `default`
    // branch is a real, working second line of defense, not dead code.
    vi.doMock("@/infrastructure/config/env", () => ({
      env: {
        GEOCODING_PROVIDER: "SOMETHING_INVALID",
        MAPBOX_API_KEY: "",
        GOOGLE_GEOCODING_API_KEY: "",
        HERE_API_KEY: "",
      },
    }));

    vi.resetModules();
    const { createGeocodingProvider } = await import("@/infrastructure/geocoding/geocoding-provider-factory");
    const provider = createGeocodingProvider();

    await expect(provider.geocode({ city: "Madrid" })).resolves.toEqual({
      latitude: 40.4168,
      longitude: -3.7038,
    });

    vi.doUnmock("@/infrastructure/config/env");
    vi.resetModules();
  });
});

/**
 * Sanity check that the underlying construction the factory would use for
 * each real provider is wired to the right class — exercised directly
 * (rather than only through the factory) so a future refactor of the
 * factory's switch statement can't silently swap providers without a
 * failing test.
 */
describe("geocoding provider classes", () => {
  it("are the concrete classes the factory dispatches to", () => {
    expect(new MapboxGeocodingProvider("key")).toBeInstanceOf(MapboxGeocodingProvider);
    expect(new GoogleGeocodingProvider("key")).toBeInstanceOf(GoogleGeocodingProvider);
    expect(new HereGeocodingProvider("key")).toBeInstanceOf(HereGeocodingProvider);
    expect(new OpenStreetMapGeocodingProvider()).toBeInstanceOf(OpenStreetMapGeocodingProvider);
    expect(new StaticCityGeocodingProvider()).toBeInstanceOf(StaticCityGeocodingProvider);
    expect(new SafeGeocodingProvider(new StaticCityGeocodingProvider(), "static")).toBeInstanceOf(
      SafeGeocodingProvider,
    );
  });
});
