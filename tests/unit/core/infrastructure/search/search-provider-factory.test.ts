import { afterEach, describe, expect, it, vi } from "vitest";

import { VALID_BASE_ENV } from "../config/env-fixture";

async function loadFactory(envOverrides: Record<string, string | undefined> = {}) {
  const mutableEnv = process.env as Record<string, string | undefined>;
  for (const [key, value] of Object.entries(VALID_BASE_ENV)) mutableEnv[key] = value;
  for (const [key, value] of Object.entries(envOverrides)) {
    if (value === undefined) delete mutableEnv[key];
    else mutableEnv[key] = value;
  }

  vi.resetModules();
  return import("@/infrastructure/search/search-provider-factory");
}

describe("infrastructure/search/search-provider-factory", () => {
  afterEach(() => {
    for (const key of [
      "SEARCH_PROVIDER",
      "MEILISEARCH_HOST",
      "MEILISEARCH_API_KEY",
      "TYPESENSE_HOST",
      "TYPESENSE_API_KEY",
      "SEARCH_INDEX_PREFIX",
    ]) {
      delete (process.env as Record<string, string | undefined>)[key];
    }
  });

  it("defaults to the in-memory provider when SEARCH_PROVIDER is unset", async () => {
    const { createSearchProvider } = await loadFactory();
    expect(createSearchProvider().name).toBe("memory");
  });

  it("selects Meilisearch when configured with a host", async () => {
    const { createSearchProvider } = await loadFactory({
      SEARCH_PROVIDER: "meilisearch",
      MEILISEARCH_HOST: "http://localhost:7700",
    });
    expect(createSearchProvider().name).toBe("meilisearch");
  });

  it("falls back to in-memory when meilisearch is selected but MEILISEARCH_HOST is missing", async () => {
    const { createSearchProvider } = await loadFactory({ SEARCH_PROVIDER: "meilisearch" });
    expect(createSearchProvider().name).toBe("memory");
  });

  it("selects Typesense when configured with a host", async () => {
    const { createSearchProvider } = await loadFactory({
      SEARCH_PROVIDER: "typesense",
      TYPESENSE_HOST: "http://localhost:8108",
    });
    expect(createSearchProvider().name).toBe("typesense");
  });

  it("falls back to in-memory when typesense is selected but TYPESENSE_HOST is missing", async () => {
    const { createSearchProvider } = await loadFactory({ SEARCH_PROVIDER: "typesense" });
    expect(createSearchProvider().name).toBe("memory");
  });

  it("memoizes — returns the same instance on every call", async () => {
    const { createSearchProvider } = await loadFactory();
    expect(createSearchProvider()).toBe(createSearchProvider());
  });

  it("__testing.reset() forces the next call to re-decide", async () => {
    const { createSearchProvider, __testing } = await loadFactory();
    const first = createSearchProvider();
    __testing.reset();
    const second = createSearchProvider();
    expect(second).not.toBe(first);
  });
});
