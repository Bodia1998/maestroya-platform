import { describe, expect, it, vi } from "vitest";

import type { SearchIndexProvider, SearchProviderStatus } from "@/application/ports/search-index-provider";
import { collectSearchEngineHealth, DISABLED_SEARCH_ENGINE_HEALTH } from "@/infrastructure/search/search-health";
import { getSearchSyncState } from "@/infrastructure/search/search-sync-state";

function fakeProvider(status: SearchProviderStatus): SearchIndexProvider {
  return { ping: vi.fn().mockResolvedValue(status) } as unknown as SearchIndexProvider;
}

describe("infrastructure/search/search-health", () => {
  it("DISABLED_SEARCH_ENGINE_HEALTH reports status 'disabled' and no engine", () => {
    expect(DISABLED_SEARCH_ENGINE_HEALTH.status).toBe("disabled");
    expect(DISABLED_SEARCH_ENGINE_HEALTH.reachable).toBe(false);
  });

  it("reports status 'ok' when the provider and queues are all reachable", async () => {
    getSearchSyncState().reset();
    const provider = fakeProvider({ provider: "memory", reachable: true, documentCount: 5, latencyMs: 1 });
    const queue = { name: "search-index", getCounts: vi.fn().mockResolvedValue({ waiting: 0, delayed: 0, active: 0, completed: 1, failed: 0 }) };

    const report = await collectSearchEngineHealth({
      provider,
      indexName: "maestroya_search_v1",
      indexVersion: 1,
      indexingEnabled: true,
      queues: [queue],
      sync: getSearchSyncState().snapshot(),
    });

    expect(report.status).toBe("ok");
    expect(report.reachable).toBe(true);
    expect(report.documentCount).toBe(5);
    expect(report.queue["search-index"]).toEqual({ waiting: 0, delayed: 0, active: 0, completed: 1, failed: 0 });
  });

  it("reports status 'degraded' (never 'error') when the provider is unreachable", async () => {
    const provider = fakeProvider({
      provider: "meilisearch",
      reachable: false,
      documentCount: null,
      latencyMs: 20,
      error: "connection refused",
    });

    const report = await collectSearchEngineHealth({
      provider,
      indexName: "idx",
      indexVersion: 1,
      indexingEnabled: true,
      queues: [],
      sync: getSearchSyncState().snapshot(),
    });

    expect(report.status).toBe("degraded");
    expect(report.error).toBe("connection refused");
  });

  it("never throws — a failing queue.getCounts() is folded into the report, not propagated", async () => {
    const provider = fakeProvider({ provider: "memory", reachable: true, documentCount: 0, latencyMs: 0 });
    const failingQueue = { name: "search-index", getCounts: vi.fn().mockRejectedValue(new Error("store down")) };

    const report = await collectSearchEngineHealth({
      provider,
      indexName: "idx",
      indexVersion: 1,
      indexingEnabled: true,
      queues: [failingQueue],
      sync: getSearchSyncState().snapshot(),
    });

    expect(report.status).toBe("degraded");
    expect(report.error).toBe("store down");
  });

  it("includes indexName/indexVersion/indexingEnabled as given", async () => {
    const provider = fakeProvider({ provider: "memory", reachable: true, documentCount: 0, latencyMs: 0 });

    const report = await collectSearchEngineHealth({
      provider,
      indexName: "maestroya_search_v1",
      indexVersion: 1,
      indexingEnabled: false,
      queues: [],
      sync: getSearchSyncState().snapshot(),
    });

    expect(report.indexName).toBe("maestroya_search_v1");
    expect(report.indexVersion).toBe(1);
    expect(report.indexingEnabled).toBe(false);
  });
});
