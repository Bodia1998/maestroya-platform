import { describe, expect, it, vi } from "vitest";

import type { SearchDocument } from "@/domain/entities/search-document";
import type {
  MeilisearchClientApi,
  MeilisearchIndexApi,
  MeilisearchSearchResponse,
} from "@/infrastructure/search/providers/meilisearch-search-provider";
import { MeilisearchSearchProvider } from "@/infrastructure/search/providers/meilisearch-search-provider";

function doc(): SearchDocument {
  return {
    id: "professional:1",
    kind: "PROFESSIONAL",
    entityId: "1",
    title: "Ana",
    subtitle: null,
    text: "ana fontanera",
    categoryIds: ["cat-1"],
    city: "Madrid",
    province: "Madrid",
    latitude: 40.4,
    longitude: -3.7,
    isVerified: true,
    averageRating: 4.5,
    reviewCount: 10,
    portfolioItemCount: 2,
    createdAt: new Date("2025-01-01T00:00:00.000Z").toISOString(),
    indexedAt: new Date("2026-01-01T00:00:00.000Z").toISOString(),
  };
}

/**
 * Deliberately not typed as `MeilisearchIndexApi` — that would widen every
 * member back to a plain function and hide `.mock` from the tests below
 * that assert on call arguments. The object is still structurally
 * assignable to `MeilisearchIndexApi` wherever it's passed (see
 * `fakeClient`), which is all `MeilisearchSearchProvider` needs.
 */
function fakeIndex(overrides: Partial<Record<keyof MeilisearchIndexApi, ReturnType<typeof vi.fn>>> = {}) {
  return {
    addDocuments: vi.fn().mockResolvedValue({}),
    deleteDocument: vi.fn().mockResolvedValue({}),
    deleteDocuments: vi.fn().mockResolvedValue({}),
    search: vi.fn().mockResolvedValue({ hits: [], totalHits: 0, processingTimeMs: 1 } satisfies MeilisearchSearchResponse),
    getStats: vi.fn().mockResolvedValue({ numberOfDocuments: 0 }),
    updateSettings: vi.fn().mockResolvedValue({}),
    ...overrides,
  };
}

function fakeClient(index: MeilisearchIndexApi, healthy = true): MeilisearchClientApi {
  return {
    index: vi.fn().mockReturnValue(index),
    health: vi.fn().mockResolvedValue({ status: healthy ? "available" : "unavailable" }),
  };
}

describe("infrastructure/search/providers/meilisearch-search-provider", () => {
  it("indexDocuments asserts settings once, then upserts with the id primary key", async () => {
    const index = fakeIndex();
    const provider = new MeilisearchSearchProvider(fakeClient(index), "maestroya_search_v1");

    await provider.indexDocuments([doc()]);
    await provider.indexDocuments([doc()]);

    expect(index.updateSettings).toHaveBeenCalledTimes(1);
    expect(index.addDocuments).toHaveBeenCalledTimes(2);
    expect(index.addDocuments).toHaveBeenCalledWith(expect.any(Array), { primaryKey: "id" });
  });

  it("indexDocuments with an empty array is a no-op (no settings call, no addDocuments call)", async () => {
    const index = fakeIndex();
    const provider = new MeilisearchSearchProvider(fakeClient(index), "idx");

    await provider.indexDocuments([]);

    expect(index.updateSettings).not.toHaveBeenCalled();
    expect(index.addDocuments).not.toHaveBeenCalled();
  });

  it("indexDocuments projects numeric createdAtMs/indexedAtMs and a _geo field when coordinates exist", async () => {
    const index = fakeIndex();
    const provider = new MeilisearchSearchProvider(fakeClient(index), "idx");

    await provider.indexDocuments([doc()]);

    const [[payload]] = index.addDocuments.mock.calls as unknown as [[Record<string, unknown>[]]];
    expect(payload[0]).toMatchObject({
      createdAtMs: Date.parse("2025-01-01T00:00:00.000Z"),
      indexedAtMs: Date.parse("2026-01-01T00:00:00.000Z"),
      _geo: { lat: 40.4, lng: -3.7 },
    });
  });

  it("deleteDocument calls the index by document id", async () => {
    const index = fakeIndex();
    const provider = new MeilisearchSearchProvider(fakeClient(index), "idx");
    await provider.deleteDocument("professional:1");
    expect(index.deleteDocument).toHaveBeenCalledWith("professional:1");
  });

  it("deleteByFilter builds an ANDed filter string and falls back to 'id EXISTS' for an empty filter", async () => {
    const index = fakeIndex({
      search: vi.fn().mockResolvedValue({ hits: [], totalHits: 3 }),
    });
    const provider = new MeilisearchSearchProvider(fakeClient(index), "idx");

    const removed = await provider.deleteByFilter({ kind: "PROFESSIONAL", entityId: "1" });
    expect(index.deleteDocuments).toHaveBeenCalledWith({ filter: `kind = "PROFESSIONAL" AND entityId = "1"` });
    expect(removed).toBe(3);

    await provider.deleteByFilter({});
    expect(index.deleteDocuments).toHaveBeenLastCalledWith({ filter: "id EXISTS" });
  });

  it("search builds category OR-clauses, a geo radius clause, and translates sort options", async () => {
    const index = fakeIndex({
      search: vi.fn().mockResolvedValue({
        hits: [{ ...doc(), _rankingScore: 0.87, _geoDistance: 5000 }],
        totalHits: 1,
        processingTimeMs: 12,
      }),
    });
    const provider = new MeilisearchSearchProvider(fakeClient(index), "idx");

    const result = await provider.search({
      text: "fontanera",
      categoryIds: ["cat-1", "cat-2"],
      verifiedOnly: true,
      near: { latitude: 40.4, longitude: -3.7, radiusKm: 10 },
      sort: "RATING",
      page: 2,
      pageSize: 5,
    });

    const [, params] = index.search.mock.calls[0] as [string, Record<string, unknown>];
    expect(params.filter).toContain(`(categoryIds = "cat-1" OR categoryIds = "cat-2")`);
    expect(params.filter).toContain("isVerified = true");
    expect(params.filter).toContain("_geoRadius(40.4, -3.7, 10000)");
    expect(params.sort).toEqual(["averageRating:desc"]);
    expect(params.page).toBe(2);
    expect(params.hitsPerPage).toBe(5);

    expect(result.hits[0]!.score).toBe(0.87);
    expect(result.hits[0]!.distanceKm).toBe(5);
    expect(result.total).toBe(1);
    expect(result.tookMs).toBe(12);
  });

  it("search with fuzzy: false disables typo tolerance for that query only", async () => {
    const index = fakeIndex();
    const provider = new MeilisearchSearchProvider(fakeClient(index), "idx");

    await provider.search({ text: "exact", fuzzy: false, page: 1, pageSize: 10 });

    const [, params] = index.search.mock.calls[0] as [string, Record<string, unknown>];
    expect(params.typoTolerance).toEqual({ enabled: false });
  });

  it("countDocuments returns total stats when no kind is given, or a filtered count otherwise", async () => {
    const index = fakeIndex({
      getStats: vi.fn().mockResolvedValue({ numberOfDocuments: 42 }),
      search: vi.fn().mockResolvedValue({ hits: [], totalHits: 7 }),
    });
    const provider = new MeilisearchSearchProvider(fakeClient(index), "idx");

    expect(await provider.countDocuments()).toBe(42);
    expect(await provider.countDocuments("PROFESSIONAL")).toBe(7);
  });

  it("ping reports reachable: true with document count and latency", async () => {
    const index = fakeIndex({ getStats: vi.fn().mockResolvedValue({ numberOfDocuments: 5 }) });
    const provider = new MeilisearchSearchProvider(fakeClient(index, true), "idx");

    const status = await provider.ping();

    expect(status.reachable).toBe(true);
    expect(status.provider).toBe("meilisearch");
    expect(status.documentCount).toBe(5);
    expect(status.latencyMs).toBeGreaterThanOrEqual(0);
  });

  it("ping never throws — an unreachable client is reported, not propagated", async () => {
    const client: MeilisearchClientApi = {
      index: vi.fn().mockReturnValue(fakeIndex()),
      health: vi.fn().mockRejectedValue(new Error("connection refused")),
    };
    const provider = new MeilisearchSearchProvider(client, "idx");

    const status = await provider.ping();

    expect(status.reachable).toBe(false);
    expect(status.error).toBe("connection refused");
  });
});
