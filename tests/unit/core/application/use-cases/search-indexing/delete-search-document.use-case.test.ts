import { describe, expect, it, vi } from "vitest";

import type { SearchDocument } from "@/domain/entities/search-document";
import { InMemorySearchProvider } from "@/infrastructure/search/providers/in-memory-search-provider";
import { nullSearchObserver, type SearchObserver } from "@/application/ports/search-observer";
import { DeleteSearchDocumentUseCase } from "@/application/use-cases/search-indexing/delete-search-document.use-case";

function doc(): SearchDocument {
  return {
    id: "company:company-1",
    kind: "COMPANY",
    entityId: "company-1",
    title: "Reformas",
    subtitle: null,
    text: "reformas",
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

describe("application/use-cases/search-indexing/delete-search-document", () => {
  it("removes the document by its deterministic id", async () => {
    const provider = new InMemorySearchProvider();
    await provider.indexDocument(doc());
    const useCase = new DeleteSearchDocumentUseCase(provider);

    const result = await useCase.execute({ kind: "COMPANY", entityId: "company-1" });

    expect(result).toEqual({ documentId: "company:company-1" });
    expect(await provider.countDocuments()).toBe(0);
  });

  it("deleting an absent document is a no-op, not an error", async () => {
    const provider = new InMemorySearchProvider();
    const useCase = new DeleteSearchDocumentUseCase(provider);

    await expect(useCase.execute({ kind: "COMPANY", entityId: "never-existed" })).resolves.toEqual({
      documentId: "company:never-existed",
    });
  });

  it("reports onRemoved with reason 'requested' and onSyncCompleted", async () => {
    const provider = new InMemorySearchProvider();
    await provider.indexDocument(doc());
    const onRemoved = vi.fn();
    const onSyncCompleted = vi.fn();
    const observer: SearchObserver = { ...nullSearchObserver, onRemoved, onSyncCompleted };
    const useCase = new DeleteSearchDocumentUseCase(provider, observer);

    await useCase.execute({ kind: "COMPANY", entityId: "company-1" });

    expect(onRemoved).toHaveBeenCalledWith(expect.objectContaining({ reason: "requested" }));
    expect(onSyncCompleted).toHaveBeenCalledWith(expect.objectContaining({ operation: "delete" }));
  });

  it("reports and rethrows a provider failure", async () => {
    const failure = new Error("engine down");
    const provider = { deleteDocument: vi.fn().mockRejectedValue(failure) } as never;
    const onError = vi.fn();
    const useCase = new DeleteSearchDocumentUseCase(provider, { ...nullSearchObserver, onError });

    await expect(useCase.execute({ kind: "COMPANY", entityId: "company-1" })).rejects.toBe(failure);
    expect(onError).toHaveBeenCalledTimes(1);
  });
});
