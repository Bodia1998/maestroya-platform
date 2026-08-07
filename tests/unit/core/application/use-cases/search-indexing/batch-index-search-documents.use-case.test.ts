import { describe, expect, it, vi } from "vitest";

import type { SearchDocument, SearchDocumentKind } from "@/domain/entities/search-document";
import { InMemorySearchProvider } from "@/infrastructure/search/providers/in-memory-search-provider";
import { nullSearchObserver, type SearchObserver } from "@/application/ports/search-observer";
import type { SearchDocumentProjector } from "@/application/services/search/search-document-projector";
import { BatchIndexSearchDocumentsUseCase } from "@/application/use-cases/search-indexing/batch-index-search-documents.use-case";

function doc(entityId: string, kind: SearchDocumentKind = "PROFESSIONAL"): SearchDocument {
  return {
    id: `${kind.toLowerCase()}:${entityId}`,
    kind,
    entityId,
    title: entityId,
    subtitle: null,
    text: entityId,
    categoryIds: [],
    city: null,
    province: null,
    latitude: null,
    longitude: null,
    isVerified: false,
    averageRating: null,
    reviewCount: 0,
    portfolioItemCount: 0,
    createdAt: new Date().toISOString(),
    indexedAt: new Date().toISOString(),
  };
}

function fakeProjector(documents: SearchDocument[], missingIds: string[]): SearchDocumentProjector {
  return {
    project: vi.fn(),
    projectMany: vi.fn().mockResolvedValue({ documents, missingIds }),
  } as unknown as SearchDocumentProjector;
}

describe("application/use-cases/search-indexing/batch-index-search-documents", () => {
  it("an empty entityIds array is a no-op", async () => {
    const provider = new InMemorySearchProvider();
    const useCase = new BatchIndexSearchDocumentsUseCase(provider, fakeProjector([], []));

    const result = await useCase.execute({ kind: "PROFESSIONAL", entityIds: [] });

    expect(result).toEqual({ indexed: 0, removed: 0, durationMs: 0 });
  });

  it("indexes eligible documents in one batch write and deletes ineligible ones individually", async () => {
    const provider = new InMemorySearchProvider();
    const projector = fakeProjector([doc("a"), doc("b")], ["c"]);
    const useCase = new BatchIndexSearchDocumentsUseCase(provider, projector);

    const result = await useCase.execute({ kind: "PROFESSIONAL", entityIds: ["a", "b", "c"] });

    expect(result.indexed).toBe(2);
    expect(result.removed).toBe(1);
    expect(await provider.countDocuments()).toBe(2);
  });

    it("reports onBatchIndexed/onSyncCompleted", async () => {
    const provider = new InMemorySearchProvider();
    const projector = fakeProjector([doc("a")], []);
    const onBatchIndexed = vi.fn();
    const onSyncCompleted = vi.fn();
    const observer: SearchObserver = { ...nullSearchObserver, onBatchIndexed, onSyncCompleted };
    const useCase = new BatchIndexSearchDocumentsUseCase(provider, projector, observer);

    await useCase.execute({ kind: "PROFESSIONAL", entityIds: ["a"] });

    expect(onBatchIndexed).toHaveBeenCalledWith(expect.objectContaining({ indexed: 1, removed: 0 }));
    expect(onSyncCompleted).toHaveBeenCalledWith(expect.objectContaining({ operation: "batch", documentCount: 1 }));
  });

  it("reports and rethrows a provider failure", async () => {
    const failure = new Error("engine down");
    const provider = { indexDocuments: vi.fn().mockRejectedValue(failure) } as never;
    const projector = fakeProjector([doc("a")], []);
    const onError = vi.fn();
    const useCase = new BatchIndexSearchDocumentsUseCase(provider, projector, { ...nullSearchObserver, onError });

    await expect(useCase.execute({ kind: "PROFESSIONAL", entityIds: ["a"] })).rejects.toBe(failure);
    expect(onError).toHaveBeenCalledTimes(1);
  });

  it("duplicate ids in the input are harmless (deterministic ids upsert)", async () => {
    const provider = new InMemorySearchProvider();
    const projector = fakeProjector([doc("a"), doc("a")], []);
    const useCase = new BatchIndexSearchDocumentsUseCase(provider, projector);

    await useCase.execute({ kind: "PROFESSIONAL", entityIds: ["a", "a"] });

    expect(await provider.countDocuments()).toBe(1);
  });
});
