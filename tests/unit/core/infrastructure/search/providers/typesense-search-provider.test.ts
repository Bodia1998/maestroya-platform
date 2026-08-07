import { describe, expect, it, vi } from "vitest";

import type { SearchDocument } from "@/domain/entities/search-document";
import type {
  TypesenseClientApi,
  TypesenseCollectionApi,
  TypesenseDocumentsApi,
} from "@/infrastructure/search/providers/typesense-search-provider";
import { TypesenseSearchProvider } from "@/infrastructure/search/providers/typesense-search-provider";

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
 * Deliberately not typed as `TypesenseDocumentsApi` — see the identical
 * note on the Meilisearch provider test's `fakeIndex`.
 */
function fakeDocumentsApi(overrides: Partial<Record<keyof TypesenseDocumentsApi, ReturnType<typeof vi.fn>>> = {}) {
  return {
    import: vi.fn().mockResolvedValue({}),
    delete: vi.fn().mockResolvedValue({ num_deleted: 0 }),
    search: vi.fn().mockResolvedValue({ found: 0, hits: [] }),
    ...overrides,
  };
}

function fakeCollection(documentsApi: TypesenseDocumentsApi, byIdDelete = vi.fn().mockResolvedValue({})): TypesenseCollectionApi {
  return {
    documents: ((documentId?: string) => {
      if (documentId !== undefined) return { delete: byIdDelete };
      return documentsApi;
    }) as TypesenseCollectionApi["documents"],
    retrieve: vi.fn().mockResolvedValue({ num_documents: 0 }),
  };
}

function fakeClient(collection: TypesenseCollectionApi, healthy = true): TypesenseClientApi {
  return {
    collections: vi.fn().mockReturnValue(collection),
    health: { retrieve: vi.fn().mockResolvedValue({ ok: healthy }) },
  };
}

describe("infrastructure/search/providers/typesense-search-provider", () => {
  it("indexDocuments upserts via import with action: upsert", async () => {
    const documentsApi = fakeDocumentsApi();
    const provider = new TypesenseSearchProvider(fakeClient(fakeCollection(documentsApi)), "maestroya_search_v1");

    await provider.indexDocuments([doc()]);

    expect(documentsApi.import).toHaveBeenCalledWith(expect.any(Array), { action: "upsert" });
  });

  it("indexDocuments with an empty array is a no-op", async () => {
    const documentsApi = fakeDocumentsApi();
    const provider = new TypesenseSearchProvider(fakeClient(fakeCollection(documentsApi)), "idx");

    await provider.indexDocuments([]);

    expect(documentsApi.import).not.toHaveBeenCalled();
  });

  it("indexDocuments projects a location tuple only when coordinates exist", async () => {
    const documentsApi = fakeDocumentsApi();
    const provider = new TypesenseSearchProvider(fakeClient(fakeCollection(documentsApi)), "idx");

    await provider.indexDocuments([doc(), { ...doc(), id: "professional:2", latitude: null, longitude: null }]);

    const [[payload]] = documentsApi.import.mock.calls as unknown as [[Record<string, unknown>[]]];
    expect(payload[0]!.location).toEqual([40.4, -3.7]);
    expect(payload[1]!.location).toBeUndefined();
  });

  it("deleteDocument treats a 404 as a no-op but rethrows any other failure", async () => {
    const notFound = Object.assign(new Error("not found"), { httpStatus: 404 });
    const byIdDelete404 = vi.fn().mockRejectedValue(notFound);
    const provider404 = new TypesenseSearchProvider(
      fakeClient(fakeCollection(fakeDocumentsApi(), byIdDelete404)),
      "idx",
    );
    await expect(provider404.deleteDocument("professional:1")).resolves.toBeUndefined();

    const serverError = Object.assign(new Error("server error"), { httpStatus: 500 });
    const byIdDelete500 = vi.fn().mockRejectedValue(serverError);
    const provider500 = new TypesenseSearchProvider(
      fakeClient(fakeCollection(fakeDocumentsApi(), byIdDelete500)),
      "idx",
    );
    await expect(provider500.deleteDocument("professional:1")).rejects.toBe(serverError);
  });

  it("deleteByFilter joins clauses with && and falls back to 'id:!=null' for an empty filter", async () => {
    const documentsApi = fakeDocumentsApi({ delete: vi.fn().mockResolvedValue({ num_deleted: 2 }) });
    const provider = new TypesenseSearchProvider(fakeClient(fakeCollection(documentsApi)), "idx");

    const removed = await provider.deleteByFilter({ kind: "PROFESSIONAL", entityId: "1" });
    expect(documentsApi.delete).toHaveBeenCalledWith({ filter_by: "kind:=PROFESSIONAL && entityId:=1" });
    expect(removed).toBe(2);

    await provider.deleteByFilter({});
    expect(documentsApi.delete).toHaveBeenLastCalledWith({ filter_by: "id:!=null" });
  });

  it("search builds filter_by/sort_by, normalizes text_match, and reads geo distance", async () => {
    const documentsApi = fakeDocumentsApi({
      search: vi.fn().mockResolvedValue({
        found: 1,
        search_time_ms: 4,
        hits: [{ document: doc() as unknown as Record<string, unknown>, text_match: 578_725_735_720_550_400, geo_distance_meters: { location: 3000 } }],
      }),
    });
    const provider = new TypesenseSearchProvider(fakeClient(fakeCollection(documentsApi)), "idx");

    const result = await provider.search({
      text: "fontanera",
      categoryIds: ["cat-1"],
      near: { latitude: 40.4, longitude: -3.7, radiusKm: 10 },
      sort: "REVIEWS",
      page: 1,
      pageSize: 10,
    });

    const [params] = documentsApi.search.mock.calls[0] as [Record<string, unknown>];
    expect(params.filter_by).toContain("categoryIds:=[cat-1]");
    expect(params.filter_by).toContain("location:(40.4, -3.7, 10 km)");
    expect(params.sort_by).toBe("reviewCount:desc");

    expect(result.hits[0]!.score).toBeCloseTo(0.5, 1);
    expect(result.hits[0]!.distanceKm).toBe(3);
    expect(result.total).toBe(1);
    expect(result.tookMs).toBe(4);
  });

  it("search uses '*' as the match-all query when text is empty", async () => {
    const documentsApi = fakeDocumentsApi();
    const provider = new TypesenseSearchProvider(fakeClient(fakeCollection(documentsApi)), "idx");

    await provider.search({ page: 1, pageSize: 10 });

    const [params] = documentsApi.search.mock.calls[0] as [Record<string, unknown>];
    expect(params.q).toBe("*");
  });

  it("search sets num_typos to 0 when fuzzy is false, 2 (the default) otherwise", async () => {
    const documentsApi = fakeDocumentsApi();
    const provider = new TypesenseSearchProvider(fakeClient(fakeCollection(documentsApi)), "idx");

    await provider.search({ page: 1, pageSize: 10, fuzzy: false });
    expect((documentsApi.search.mock.calls[0]![0] as Record<string, unknown>).num_typos).toBe(0);

    await provider.search({ page: 1, pageSize: 10, fuzzy: true });
    expect((documentsApi.search.mock.calls[1]![0] as Record<string, unknown>).num_typos).toBe(2);
  });

  it("countDocuments returns the collection total, or a filtered count for one kind", async () => {
    const collection = fakeCollection(
      fakeDocumentsApi({ search: vi.fn().mockResolvedValue({ found: 9, hits: [] }) }),
    );
    collection.retrieve = vi.fn().mockResolvedValue({ num_documents: 99 });
    const provider = new TypesenseSearchProvider(fakeClient(collection), "idx");

    expect(await provider.countDocuments()).toBe(99);
    expect(await provider.countDocuments("PROFESSIONAL")).toBe(9);
  });

  it("ping reports reachable: true with document count", async () => {
    const collection = fakeCollection(fakeDocumentsApi());
    collection.retrieve = vi.fn().mockResolvedValue({ num_documents: 3 });
    const provider = new TypesenseSearchProvider(fakeClient(collection, true), "idx");

    const status = await provider.ping();

    expect(status.reachable).toBe(true);
    expect(status.provider).toBe("typesense");
    expect(status.documentCount).toBe(3);
  });

  it("ping never throws on a failing client", async () => {
    const client: TypesenseClientApi = {
      collections: vi.fn().mockReturnValue(fakeCollection(fakeDocumentsApi())),
      health: { retrieve: vi.fn().mockRejectedValue(new Error("timeout")) },
    };
    const provider = new TypesenseSearchProvider(client, "idx");

    const status = await provider.ping();

    expect(status.reachable).toBe(false);
    expect(status.error).toBe("timeout");
  });
});
