import { describe, expect, it, vi } from "vitest";

import { InMemorySearchProvider } from "@/infrastructure/search/providers/in-memory-search-provider";
import { nullSearchObserver, type SearchObserver } from "@/application/ports/search-observer";
import { SearchReadModelUseCase } from "@/application/use-cases/search/search-read-model.use-case";

describe("application/use-cases/search/search-read-model", () => {
  it("returns paginated results with defaults applied", async () => {
    const provider = new InMemorySearchProvider();
    await provider.indexDocument({
      id: "professional:p1",
      kind: "PROFESSIONAL",
      entityId: "p1",
      title: "Ana",
      subtitle: null,
      text: "ana fontanera",
      categoryIds: [],
      city: null,
      province: null,
      latitude: null,
      longitude: null,
      isVerified: true,
      averageRating: 4.5,
      reviewCount: 10,
      portfolioItemCount: 0,
      createdAt: new Date().toISOString(),
      indexedAt: new Date().toISOString(),
    });
    const useCase = new SearchReadModelUseCase(provider);

    const result = await useCase.execute({});

    expect(result.degraded).toBe(false);
    expect(result.total).toBe(1);
    expect(result.page).toBe(1);
    expect(result.pageSize).toBe(20);
    expect(result.items[0]!.document.entityId).toBe("p1");
  });

  it("passes latitude/longitude as a distance origin without radius filtering anything out", async () => {
    const provider = new InMemorySearchProvider();
    const searchSpy = vi.spyOn(provider, "search");
    const useCase = new SearchReadModelUseCase(provider);

    await useCase.execute({ latitude: 10, longitude: 20 });

    expect(searchSpy).toHaveBeenCalledWith(
      expect.objectContaining({ near: { latitude: 10, longitude: 20, radiusKm: undefined } }),
    );
  });

  it("omits 'near' entirely when no coordinates are supplied", async () => {
    const provider = new InMemorySearchProvider();
    const searchSpy = vi.spyOn(provider, "search");
    const useCase = new SearchReadModelUseCase(provider);

    await useCase.execute({});

    expect(searchSpy).toHaveBeenCalledWith(expect.objectContaining({ near: undefined }));
  });

  it("degrades gracefully to an empty, flagged result when the provider throws", async () => {
    const provider = { search: vi.fn().mockRejectedValue(new Error("engine down")) } as never;
    const onDegraded = vi.fn();
    const observer: SearchObserver = { ...nullSearchObserver, onDegraded };
    const useCase = new SearchReadModelUseCase(provider, observer);

    const result = await useCase.execute({});

    expect(result).toEqual({ items: [], page: 1, pageSize: 20, total: 0, tookMs: 0, degraded: true });
    expect(onDegraded).toHaveBeenCalledWith(expect.objectContaining({ operation: "search" }));
  });

  it("clamps page/pageSize to sane bounds", async () => {
    const provider = new InMemorySearchProvider();
    const useCase = new SearchReadModelUseCase(provider);

    const result = await useCase.execute({ page: 0, pageSize: 10000 });

    expect(result.page).toBe(1);
    expect(result.pageSize).toBe(50);
  });
});
