import { describe, expect, it, vi } from "vitest";

import type { SearchDocument } from "@/domain/entities/search-document";
import { InMemorySearchProvider } from "@/infrastructure/search/providers/in-memory-search-provider";
import type { SearchObserver } from "@/application/ports/search-observer";
import { nullSearchObserver } from "@/application/ports/search-observer";
import type { SearchDocumentProjector } from "@/application/services/search/search-document-projector";
import { IndexSearchDocumentUseCase } from "@/application/use-cases/search-indexing/index-search-document.use-case";

function doc(overrides: Partial<SearchDocument> = {}): SearchDocument {
  return {
    id: "professional:prof-1",
    kind: "PROFESSIONAL",
    entityId: "prof-1",
    title: "Ana",
    subtitle: null,
    text: "ana",
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
    ...overrides,
  };
}

function fakeProjector(result: SearchDocument | null): SearchDocumentProjector {
  return { project: vi.fn().mockResolvedValue(result), projectMany: vi.fn() } as unknown as SearchDocumentProjector;
}

describe("application/use-cases/search-indexing/index-search-document", () => {
  it("indexes the projected document and reports 'indexed'", async () => {
    const provider = new InMemorySearchProvider();
    const projector = fakeProjector(doc());
    const useCase = new IndexSearchDocumentUseCase(provider, projector);

    const result = await useCase.execute({ kind: "PROFESSIONAL", entityId: "prof-1" });

    expect(result).toEqual({ documentId: "professional:prof-1", action: "indexed" });
    expect(await provider.countDocuments()).toBe(1);
  });

  it("removes the document and reports 'removed' when the entity is no longer eligible", async () => {
    const provider = new InMemorySearchProvider();
    await provider.indexDocument(doc());
    const projector = fakeProjector(null);
    const useCase = new IndexSearchDocumentUseCase(provider, projector);

    const result = await useCase.execute({ kind: "PROFESSIONAL", entityId: "prof-1" });

    expect(result).toEqual({ documentId: "professional:prof-1", action: "removed" });
    expect(await provider.countDocuments()).toBe(0);
  });

  it("reports onIndexed/onSyncCompleted through the observer", async () => {
    const provider = new InMemorySearchProvider();
    const projector = fakeProjector(doc());
    const onIndexed = vi.fn();
    const onSyncCompleted = vi.fn();
    const observer: SearchObserver = { ...nullSearchObserver, onIndexed, onSyncCompleted };
    const useCase = new IndexSearchDocumentUseCase(provider, projector, observer);

    await useCase.execute({ kind: "PROFESSIONAL", entityId: "prof-1" });

    expect(onIndexed).toHaveBeenCalledTimes(1);
    expect(onSyncCompleted).toHaveBeenCalledWith(expect.objectContaining({ operation: "index", documentCount: 1 }));
  });

  it("does NOT catch a provider error — it reports and rethrows so the worker can retry", async () => {
    const failure = new Error("engine down");
    const provider = { indexDocument: vi.fn().mockRejectedValue(failure) } as never;
    const projector = fakeProjector(doc());
    const onError = vi.fn();
    const useCase = new IndexSearchDocumentUseCase(provider, projector, { ...nullSearchObserver, onError });

    await expect(useCase.execute({ kind: "PROFESSIONAL", entityId: "prof-1" })).rejects.toBe(failure);
    expect(onError).toHaveBeenCalledWith(expect.objectContaining({ operation: "index", error: failure }));
  });
});
