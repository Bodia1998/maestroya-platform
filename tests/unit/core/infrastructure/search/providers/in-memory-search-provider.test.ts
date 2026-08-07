import { describe, expect, it } from "vitest";

import type { SearchDocument } from "@/domain/entities/search-document";
import { InMemorySearchProvider } from "@/infrastructure/search/providers/in-memory-search-provider";

function doc(overrides: Partial<SearchDocument> = {}): SearchDocument {
  return {
    id: overrides.id ?? `professional:${overrides.entityId ?? "x"}`,
    kind: "PROFESSIONAL",
    entityId: "x",
    title: "Ana García",
    subtitle: "Fontanería Ana",
    text: "fontanera de confianza madrid",
    categoryIds: ["cat-1"],
    city: "Madrid",
    province: "Madrid",
    latitude: 40.4168,
    longitude: -3.7038,
    isVerified: false,
    averageRating: null,
    reviewCount: 0,
    portfolioItemCount: 0,
    createdAt: new Date("2025-01-01").toISOString(),
    indexedAt: new Date("2025-01-01").toISOString(),
    ...overrides,
  };
}

describe("infrastructure/search/providers/in-memory-search-provider", () => {
  describe("indexing", () => {
    it("indexDocument upserts by id — indexing the same id twice does not duplicate", async () => {
      const provider = new InMemorySearchProvider();
      await provider.indexDocument(doc({ id: "professional:1", entityId: "1", title: "First" }));
      await provider.indexDocument(doc({ id: "professional:1", entityId: "1", title: "Second" }));

      expect(await provider.countDocuments()).toBe(1);
      const result = await provider.search({ page: 1, pageSize: 10 });
      expect(result.hits[0]!.document.title).toBe("Second");
    });

    it("stores a copy — mutating the caller's object afterwards does not change the index", async () => {
      const provider = new InMemorySearchProvider();
      const document = doc({ id: "professional:1", entityId: "1" });
      await provider.indexDocument(document);
      document.title = "Mutated";

      const result = await provider.search({ page: 1, pageSize: 10 });
      expect(result.hits[0]!.document.title).not.toBe("Mutated");
    });

    it("indexDocuments batch-upserts, and an empty array is a no-op", async () => {
      const provider = new InMemorySearchProvider();
      await provider.indexDocuments([]);
      expect(await provider.countDocuments()).toBe(0);

      await provider.indexDocuments([doc({ id: "professional:1", entityId: "1" }), doc({ id: "professional:2", entityId: "2" })]);
      expect(await provider.countDocuments()).toBe(2);
    });
  });

  describe("deletion", () => {
    it("deleteDocument removes by id; deleting an absent id is a no-op", async () => {
      const provider = new InMemorySearchProvider();
      await provider.indexDocument(doc({ id: "professional:1", entityId: "1" }));
      await provider.deleteDocument("professional:1");
      await expect(provider.deleteDocument("professional:does-not-exist")).resolves.toBeUndefined();
      expect(await provider.countDocuments()).toBe(0);
    });

    it("deleteByFilter by kind removes only matching documents and returns the removed count", async () => {
      const provider = new InMemorySearchProvider();
      await provider.indexDocument(doc({ id: "professional:1", entityId: "1", kind: "PROFESSIONAL" }));
      await provider.indexDocument(doc({ id: "company:1", entityId: "1", kind: "COMPANY" }));

      const removed = await provider.deleteByFilter({ kind: "PROFESSIONAL" });

      expect(removed).toBe(1);
      expect(await provider.countDocuments()).toBe(1);
      expect(await provider.countDocuments("COMPANY")).toBe(1);
    });

    it("deleteByFilter by entityId removes only that entity's document", async () => {
      const provider = new InMemorySearchProvider();
      await provider.indexDocument(doc({ id: "professional:1", entityId: "1" }));
      await provider.indexDocument(doc({ id: "professional:2", entityId: "2" }));

      await provider.deleteByFilter({ entityId: "1" });

      expect(await provider.countDocuments()).toBe(1);
    });

    it("deleteByFilter by indexedBefore removes only stale documents (the safe-rebuild sweep)", async () => {
      const provider = new InMemorySearchProvider();
      await provider.indexDocument(doc({ id: "professional:old", entityId: "old", indexedAt: new Date("2020-01-01").toISOString() }));
      await provider.indexDocument(doc({ id: "professional:new", entityId: "new", indexedAt: new Date("2026-01-01").toISOString() }));

      const removed = await provider.deleteByFilter({ indexedBefore: new Date("2025-01-01").toISOString() });

      expect(removed).toBe(1);
      const result = await provider.search({ page: 1, pageSize: 10 });
      expect(result.hits[0]!.document.entityId).toBe("new");
    });
  });

  describe("countDocuments / ping", () => {
    it("counts all documents, or only one kind", async () => {
      const provider = new InMemorySearchProvider();
      await provider.indexDocument(doc({ id: "professional:1", entityId: "1", kind: "PROFESSIONAL" }));
      await provider.indexDocument(doc({ id: "company:1", entityId: "1", kind: "COMPANY" }));

      expect(await provider.countDocuments()).toBe(2);
      expect(await provider.countDocuments("PROFESSIONAL")).toBe(1);
      expect(await provider.countDocuments("COMPANY")).toBe(1);
      expect(await provider.countDocuments("SERVICE_REQUEST")).toBe(0);
    });

    it("ping never throws and reports reachable: true with the live document count", async () => {
      const provider = new InMemorySearchProvider();
      await provider.indexDocument(doc({ id: "professional:1", entityId: "1" }));

      const status = await provider.ping();

      expect(status).toEqual({ provider: "memory", reachable: true, documentCount: 1, latencyMs: 0 });
    });
  });

  describe("search — filters", () => {
    it("filters by category (matches ANY of the requested category ids)", async () => {
      const provider = new InMemorySearchProvider();
      await provider.indexDocument(doc({ id: "professional:1", entityId: "1", categoryIds: ["cat-a"] }));
      await provider.indexDocument(doc({ id: "professional:2", entityId: "2", categoryIds: ["cat-b"] }));

      const result = await provider.search({ categoryIds: ["cat-a"], page: 1, pageSize: 10 });

      expect(result.hits.map((h) => h.document.entityId)).toEqual(["1"]);
    });

    it("filters by city and province (case/diacritic-insensitive)", async () => {
      const provider = new InMemorySearchProvider();
      await provider.indexDocument(doc({ id: "professional:1", entityId: "1", city: "Gandía" }));
      await provider.indexDocument(doc({ id: "professional:2", entityId: "2", city: "Valencia" }));

      const result = await provider.search({ city: "gandia", page: 1, pageSize: 10 });

      expect(result.hits.map((h) => h.document.entityId)).toEqual(["1"]);
    });

    it("filters verifiedOnly", async () => {
      const provider = new InMemorySearchProvider();
      await provider.indexDocument(doc({ id: "professional:1", entityId: "1", isVerified: true }));
      await provider.indexDocument(doc({ id: "professional:2", entityId: "2", isVerified: false }));

      const result = await provider.search({ verifiedOnly: true, page: 1, pageSize: 10 });

      expect(result.hits.map((h) => h.document.entityId)).toEqual(["1"]);
    });

    it("filters minRating and minReviewCount", async () => {
      const provider = new InMemorySearchProvider();
      await provider.indexDocument(doc({ id: "professional:1", entityId: "1", averageRating: 4.8, reviewCount: 20 }));
      await provider.indexDocument(doc({ id: "professional:2", entityId: "2", averageRating: 3.0, reviewCount: 2 }));

      const byRating = await provider.search({ minRating: 4, page: 1, pageSize: 10 });
      expect(byRating.hits.map((h) => h.document.entityId)).toEqual(["1"]);

      const byReviews = await provider.search({ minReviewCount: 10, page: 1, pageSize: 10 });
      expect(byReviews.hits.map((h) => h.document.entityId)).toEqual(["1"]);
    });

    it("filters by kinds", async () => {
      const provider = new InMemorySearchProvider();
      await provider.indexDocument(doc({ id: "professional:1", entityId: "1", kind: "PROFESSIONAL" }));
      await provider.indexDocument(doc({ id: "company:1", entityId: "1", kind: "COMPANY" }));

      const result = await provider.search({ kinds: ["COMPANY"], page: 1, pageSize: 10 });

      expect(result.hits).toHaveLength(1);
      expect(result.hits[0]!.document.kind).toBe("COMPANY");
    });
  });

  describe("search — text relevance and fuzziness", () => {
    it("exact title match ranks above a fuzzy near-miss", async () => {
      const provider = new InMemorySearchProvider();
      await provider.indexDocument(doc({ id: "professional:1", entityId: "1", title: "Fontanero Madrid", text: "fontanero madrid" }));
      await provider.indexDocument(doc({ id: "professional:2", entityId: "2", title: "Otro Profesional", text: "otro profesional relacionado con fontanro" }));

      const result = await provider.search({ text: "fontanero", page: 1, pageSize: 10, fuzzy: true });

      expect(result.hits[0]!.document.entityId).toBe("1");
    });

    it("matches a typo within tolerance when fuzzy is enabled", async () => {
      const provider = new InMemorySearchProvider();
      await provider.indexDocument(doc({ id: "professional:1", entityId: "1", title: "Fontanero", text: "fontanero madrid" }));

      const result = await provider.search({ text: "fontanro", page: 1, pageSize: 10, fuzzy: true });

      expect(result.hits.map((h) => h.document.entityId)).toContain("1");
    });

    it("does not fuzzy-match when fuzzy is disabled", async () => {
      const provider = new InMemorySearchProvider();
      await provider.indexDocument(doc({ id: "professional:1", entityId: "1", title: "Fontanero", text: "fontanero madrid" }));

      const result = await provider.search({ text: "fontanro", page: 1, pageSize: 10, fuzzy: false });

      expect(result.hits).toHaveLength(0);
    });

    it("requires every query token to match (AND semantics) — a single-token match is not enough", async () => {
      const provider = new InMemorySearchProvider();
      await provider.indexDocument(doc({ id: "professional:1", entityId: "1", title: "Fontanero", text: "fontanero madrid", city: "Madrid" }));
      await provider.indexDocument(doc({ id: "professional:2", entityId: "2", title: "Electricista", text: "electricista barcelona", city: "Barcelona" }));

      const result = await provider.search({ text: "fontanero valencia", page: 1, pageSize: 10 });

      expect(result.hits).toHaveLength(0);
    });

    it("multi-field weighting: a name match outranks a bio-only match for the same query", async () => {
      const provider = new InMemorySearchProvider();
      await provider.indexDocument(
        doc({ id: "professional:name-match", entityId: "name-match", title: "Reformas Express", subtitle: null, text: "reformas express empresa" }),
      );
      await provider.indexDocument(
        doc({
          id: "professional:bio-match",
          entityId: "bio-match",
          title: "Otro Nombre",
          subtitle: null,
          text: "otro nombre especialista en reformas de cocinas",
        }),
      );

      const result = await provider.search({ text: "reformas", page: 1, pageSize: 10 });

      expect(result.hits[0]!.document.entityId).toBe("name-match");
    });
  });

  describe("search — geo", () => {
    const madrid = { latitude: 40.4168, longitude: -3.7038 };
    const barcelona = { latitude: 41.3874, longitude: 2.1686 };

    it("without a radius, 'near' only annotates distance and filters nothing out", async () => {
      const provider = new InMemorySearchProvider();
      await provider.indexDocument(doc({ id: "professional:1", entityId: "1", latitude: madrid.latitude, longitude: madrid.longitude }));
      await provider.indexDocument(doc({ id: "professional:2", entityId: "2", latitude: barcelona.latitude, longitude: barcelona.longitude }));

      const result = await provider.search({ near: madrid, page: 1, pageSize: 10 });

      expect(result.hits).toHaveLength(2);
      expect(result.hits.find((h) => h.document.entityId === "1")!.distanceKm).toBeCloseTo(0, 0);
    });

    it("with a radius, excludes documents further away and documents with no coordinates", async () => {
      const provider = new InMemorySearchProvider();
      await provider.indexDocument(doc({ id: "professional:near", entityId: "near", latitude: madrid.latitude, longitude: madrid.longitude }));
      await provider.indexDocument(doc({ id: "professional:far", entityId: "far", latitude: barcelona.latitude, longitude: barcelona.longitude }));
      await provider.indexDocument(doc({ id: "professional:none", entityId: "none", latitude: null, longitude: null }));

      const result = await provider.search({ near: { ...madrid, radiusKm: 50 }, page: 1, pageSize: 10 });

      expect(result.hits.map((h) => h.document.entityId)).toEqual(["near"]);
    });

    it("sort DISTANCE orders by proximity, with no-coordinate documents last", async () => {
      const provider = new InMemorySearchProvider();
      await provider.indexDocument(doc({ id: "professional:far", entityId: "far", latitude: barcelona.latitude, longitude: barcelona.longitude }));
      await provider.indexDocument(doc({ id: "professional:near", entityId: "near", latitude: madrid.latitude, longitude: madrid.longitude }));
      await provider.indexDocument(doc({ id: "professional:none", entityId: "none", latitude: null, longitude: null }));

      const result = await provider.search({ near: madrid, sort: "DISTANCE", page: 1, pageSize: 10 });

      expect(result.hits.map((h) => h.document.entityId)).toEqual(["near", "far", "none"]);
    });
  });

  describe("search — sorting and pagination", () => {
    it("sorts by RATING, REVIEWS, and NEWEST", async () => {
      const provider = new InMemorySearchProvider();
      await provider.indexDocument(doc({ id: "professional:low", entityId: "low", averageRating: 3, reviewCount: 1, createdAt: new Date("2024-01-01").toISOString() }));
      await provider.indexDocument(doc({ id: "professional:high", entityId: "high", averageRating: 5, reviewCount: 50, createdAt: new Date("2026-01-01").toISOString() }));

      expect((await provider.search({ sort: "RATING", page: 1, pageSize: 10 })).hits.map((h) => h.document.entityId)).toEqual(["high", "low"]);
      expect((await provider.search({ sort: "REVIEWS", page: 1, pageSize: 10 })).hits.map((h) => h.document.entityId)).toEqual(["high", "low"]);
      expect((await provider.search({ sort: "NEWEST", page: 1, pageSize: 10 })).hits.map((h) => h.document.entityId)).toEqual(["high", "low"]);
    });

    it("breaks ties deterministically (score, reviews, createdAt, id) rather than by insertion order", async () => {
      const provider = new InMemorySearchProvider();
      const identical = { averageRating: 4, reviewCount: 5, createdAt: new Date("2025-01-01").toISOString() };
      await provider.indexDocument(doc({ id: "professional:b", entityId: "b", ...identical }));
      await provider.indexDocument(doc({ id: "professional:a", entityId: "a", ...identical }));

      const first = await provider.search({ page: 1, pageSize: 10 });
      const second = await provider.search({ page: 1, pageSize: 10 });

      expect(first.hits.map((h) => h.document.entityId)).toEqual(second.hits.map((h) => h.document.entityId));
      // Ascending id order (a.localeCompare(b)) resolves the final tie —
      // insertion order here was b-then-a, so this also proves it's not
      // just insertion order coming back unchanged.
      expect(first.hits.map((h) => h.document.entityId)).toEqual(["a", "b"]);
    });

    it("paginates without duplicate or missing items across pages", async () => {
      const provider = new InMemorySearchProvider();
      for (let i = 0; i < 25; i += 1) {
        await provider.indexDocument(doc({ id: `professional:${i}`, entityId: String(i), title: `Pro ${i}` }));
      }

      const page1 = await provider.search({ page: 1, pageSize: 10, sort: "NEWEST" });
      const page2 = await provider.search({ page: 2, pageSize: 10, sort: "NEWEST" });
      const page3 = await provider.search({ page: 3, pageSize: 10, sort: "NEWEST" });

      expect(page1.total).toBe(25);
      const allIds = [...page1.hits, ...page2.hits, ...page3.hits].map((h) => h.document.entityId);
      expect(new Set(allIds).size).toBe(25);
      expect(page1.hits).toHaveLength(10);
      expect(page2.hits).toHaveLength(10);
      expect(page3.hits).toHaveLength(5);
    });
  });

  describe("clear", () => {
    it("wipes the index", async () => {
      const provider = new InMemorySearchProvider();
      await provider.indexDocument(doc({ id: "professional:1", entityId: "1" }));
      provider.clear();
      expect(await provider.countDocuments()).toBe(0);
    });
  });
});
