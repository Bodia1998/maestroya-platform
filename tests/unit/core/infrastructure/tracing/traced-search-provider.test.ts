import { describe, expect, it, vi } from "vitest";

import type { SearchIndexProvider, SearchIndexQueryResult } from "@/application/ports/search-index-provider";
import { TracedSearchIndexProvider, withSearchTracing } from "@/infrastructure/tracing/traced-search-provider";
import { createFakeTracer } from "../../../../test-utils/fake-tracer";

function fakeProvider(): SearchIndexProvider {
  return {
    name: "memory",
    indexDocument: vi.fn().mockResolvedValue(undefined),
    indexDocuments: vi.fn().mockResolvedValue(undefined),
    deleteDocument: vi.fn().mockResolvedValue(undefined),
    deleteByFilter: vi.fn().mockResolvedValue(3),
    search: vi.fn().mockResolvedValue({
      hits: [],
      total: 0,
      page: 1,
      pageSize: 20,
      tookMs: 5,
    } satisfies SearchIndexQueryResult),
    countDocuments: vi.fn().mockResolvedValue(10),
    ping: vi.fn().mockResolvedValue({ provider: "memory", reachable: true, documentCount: 10, latencyMs: 1 }),
  };
}

describe("infrastructure/tracing/traced-search-provider", () => {
  it("withSearchTracing returns the delegate untouched when tracing is disabled", () => {
    const tracer = createFakeTracer({ enabled: false });
    const delegate = fakeProvider();
    expect(withSearchTracing(delegate, tracer)).toBe(delegate);
  });

  it("withSearchTracing wraps in TracedSearchIndexProvider when enabled", () => {
    expect(withSearchTracing(fakeProvider(), createFakeTracer())).toBeInstanceOf(TracedSearchIndexProvider);
  });

  it("exposes the delegate's provider name unchanged", () => {
    const traced = new TracedSearchIndexProvider(fakeProvider(), createFakeTracer());
    expect(traced.name).toBe("memory");
  });

  it("search() records total hits, returned hits and engine timing, and never leaks free-text query content", async () => {
    const tracer = createFakeTracer();
    const traced = new TracedSearchIndexProvider(fakeProvider(), tracer);

    await traced.search({ text: "fontanero madrid", page: 1, pageSize: 20 });

    const span = tracer.spans[0]!;
    expect(span.name).toBe("search.query");
    expect(span.kind).toBe("client");
    expect(span.attributes["search.has_text"]).toBe(true);
    expect(JSON.stringify(span.attributes)).not.toContain("fontanero");
  });

  it("deleteByFilter() records the number of deleted documents", async () => {
    const tracer = createFakeTracer();
    const traced = new TracedSearchIndexProvider(fakeProvider(), tracer);
    const removed = await traced.deleteByFilter({ kind: "PROFESSIONAL" as never });
    expect(removed).toBe(3);
    expect(tracer.spans[0]!.attributes["search.deleted_documents"]).toBe(3);
  });

  it("ping() is never traced (no span opened)", async () => {
    const tracer = createFakeTracer();
    const traced = new TracedSearchIndexProvider(fakeProvider(), tracer);
    const status = await traced.ping();
    expect(status.reachable).toBe(true);
    expect(tracer.spans).toHaveLength(0);
  });

  it("indexDocuments() records the batch size", async () => {
    const tracer = createFakeTracer();
    const traced = new TracedSearchIndexProvider(fakeProvider(), tracer);
    await traced.indexDocuments([{} as never, {} as never]);
    expect(tracer.spans[0]!.attributes["search.batch_size"]).toBe(2);
  });
});
