import { describe, expect, it } from "vitest";

import type { CacheProvider } from "@/application/ports/cache-provider";
import { TracedCacheProvider, withCacheTracing } from "@/infrastructure/tracing/traced-cache-provider";
import { createFakeTracer } from "../../../../test-utils/fake-tracer";

function fakeCache(): CacheProvider & { store: Map<string, unknown> } {
  const store = new Map<string, unknown>();
  return {
    store,
    async get<T>(key: string) {
      return (store.has(key) ? (store.get(key) as T) : null) as T | null;
    },
    async set(key, value) {
      store.set(key, value);
    },
    async delete(key) {
      store.delete(key);
    },
    async has(key) {
      return store.has(key);
    },
    async deletePattern(pattern) {
      const prefix = pattern.replace(/\*$/, "");
      let removed = 0;
      for (const key of Array.from(store.keys())) {
        if (key.startsWith(prefix)) {
          store.delete(key);
          removed++;
        }
      }
      return removed;
    },
  };
}

describe("infrastructure/tracing/traced-cache-provider", () => {
  it("withCacheTracing returns the delegate untouched when tracing is disabled", () => {
    const tracer = createFakeTracer({ enabled: false });
    const delegate = fakeCache();
    expect(withCacheTracing(delegate, tracer, "redis")).toBe(delegate);
  });

  it("withCacheTracing wraps in TracedCacheProvider when enabled", () => {
    const tracer = createFakeTracer();
    expect(withCacheTracing(fakeCache(), tracer, "redis")).toBeInstanceOf(TracedCacheProvider);
  });

  it("get() records cache.hit=false on a miss and true on a hit, tagging external.system", async () => {
    const tracer = createFakeTracer();
    const delegate = fakeCache();
    const traced = new TracedCacheProvider(delegate, tracer, "redis");

    await traced.get("ns:entity:123");
    expect(tracer.spans[0]!.attributes["cache.hit"]).toBe(false);
    expect(tracer.spans[0]!.attributes["external.system"]).toBe("redis");

    await delegate.set("ns:entity:123", "value", 1000);
    await traced.get("ns:entity:123");
    expect(tracer.spans[1]!.attributes["cache.hit"]).toBe(true);
  });

  it("records only the key's namespace, never the full key", async () => {
    const tracer = createFakeTracer();
    const traced = new TracedCacheProvider(fakeCache(), tracer, "redis");
    await traced.get("ratelimit:signin:user-42");
    expect(tracer.spans[0]!.attributes["cache.namespace"]).toBe("ratelimit:signin");
  });

  it("set() records the ttl", async () => {
    const tracer = createFakeTracer();
    const traced = new TracedCacheProvider(fakeCache(), tracer, "memory");
    await traced.set("ns:key", "v", 60_000);
    expect(tracer.spans[0]!.attributes["cache.ttl_ms"]).toBe(60_000);
  });

  it("deletePattern() records the pattern and the number of removed keys", async () => {
    const tracer = createFakeTracer();
    const delegate = fakeCache();
    await delegate.set("ns:a", 1, 1000);
    await delegate.set("ns:b", 2, 1000);
    const traced = new TracedCacheProvider(delegate, tracer, "memory");

    const removed = await traced.deletePattern("ns:*");
    expect(removed).toBe(2);
    expect(tracer.spans[0]!.attributes["cache.pattern"]).toBe("ns:*");
    expect(tracer.spans[0]!.attributes["cache.deleted_keys"]).toBe(2);
  });

  it("delete()/has() delegate correctly and produce spans", async () => {
    const tracer = createFakeTracer();
    const delegate = fakeCache();
    await delegate.set("ns:key", "v", 1000);
    const traced = new TracedCacheProvider(delegate, tracer, "memory");

    expect(await traced.has("ns:key")).toBe(true);
    await traced.delete("ns:key");
    expect(await traced.has("ns:key")).toBe(false);
    expect(tracer.spans.map((s) => s.name)).toEqual(["cache.has", "cache.delete", "cache.has"]);
  });
});
