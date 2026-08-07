import { describe, expect, it, vi } from "vitest";

import type { ActiveJob } from "@/infrastructure/jobs/job-types";
import type { SearchIndexJobHandlers } from "@/infrastructure/search/search-index-job-processor";
import { createSearchIndexJobProcessor } from "@/infrastructure/search/search-index-job-processor";
import type { SearchIndexJobData } from "@/infrastructure/search/search-index-jobs";

function activeJob(data: SearchIndexJobData): ActiveJob<SearchIndexJobData> {
  return { id: "job-1", queue: "search-index", name: `search.${data.operation}`, data, attempt: 1, maxAttempts: 3 };
}

/** Not typed as `SearchIndexJobHandlers` so `.execute.mock` stays visible below. */
function handlers() {
  return {
    index: { execute: vi.fn().mockResolvedValue(undefined) },
    remove: { execute: vi.fn().mockResolvedValue(undefined) },
    rebuild: { execute: vi.fn().mockResolvedValue(undefined) },
  };
}

function toHandlers(h: ReturnType<typeof handlers>): SearchIndexJobHandlers {
  return h as unknown as SearchIndexJobHandlers;
}

describe("infrastructure/search/search-index-job-processor", () => {
  it("routes an 'index' job to the index use case", async () => {
    const h = handlers();
    const processor = createSearchIndexJobProcessor(toHandlers(h));

    await processor(activeJob({ operation: "index", kind: "PROFESSIONAL", entityId: "p1" }));

    expect(h.index.execute).toHaveBeenCalledWith({ kind: "PROFESSIONAL", entityId: "p1" });
    expect(h.remove.execute).not.toHaveBeenCalled();
    expect(h.rebuild.execute).not.toHaveBeenCalled();
  });

  it("routes a 'delete' job to the delete use case", async () => {
    const h = handlers();
    const processor = createSearchIndexJobProcessor(toHandlers(h));

    await processor(activeJob({ operation: "delete", kind: "COMPANY", entityId: "c1" }));

    expect(h.remove.execute).toHaveBeenCalledWith({ kind: "COMPANY", entityId: "c1" });
  });

  it("routes a 'rebuild' job to the rebuild use case with no kind/entityId required", async () => {
    const h = handlers();
    const processor = createSearchIndexJobProcessor(toHandlers(h));

    await processor(activeJob({ operation: "rebuild" }));

    expect(h.rebuild.execute).toHaveBeenCalledWith({});
  });

  it("throws on a malformed non-rebuild job missing kind/entityId, rather than silently succeeding", async () => {
    const h = handlers();
    const processor = createSearchIndexJobProcessor(toHandlers(h));

    await expect(processor(activeJob({ operation: "index" }))).rejects.toThrow(/requires both/);
  });

  it("lets a use-case exception escape so the worker's retry/dead-letter machinery engages", async () => {
    const h = handlers();
    const failure = new Error("engine down");
    h.index.execute.mockRejectedValue(failure);
    const processor = createSearchIndexJobProcessor(toHandlers(h));

    await expect(processor(activeJob({ operation: "index", kind: "PROFESSIONAL", entityId: "p1" }))).rejects.toBe(
      failure,
    );
  });
});
