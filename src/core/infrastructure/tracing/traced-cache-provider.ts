import "server-only";

import type { CacheProvider } from "@/application/ports/cache-provider";
import type { TracingPort } from "@/application/ports/tracing";

/**
 * Module 51 — Distributed Tracing — the caching layer.
 *
 * A decorator implementing the *unmodified* `CacheProvider` port (Module
 * 46), so `CacheManager`, every `CacheNamespace`, the analytics read
 * model store and the rate limiter all become traced without knowing it.
 * Wired in `cache-provider-factory.ts`, which is already the single
 * place that decides which provider a process gets.
 *
 * ## What the spans answer
 * A cache is only worth its complexity if it is actually hitting.
 * Recording `cache.hit` per `get` puts the hit ratio *per request path*
 * in the trace — which is a different and more actionable number than
 * `checks.cachingLayer`'s process-wide counters, because it tells you
 * *which* endpoint is missing. `cache.deleted_keys` on `deletePattern`
 * does the same for invalidation storms.
 *
 * `redis` is recorded as the `external.system` when the provider is
 * Redis-backed; the in-memory provider is still traced (its spans are
 * sub-microsecond and prove the code path ran) but is not an external
 * dependency, so it is tagged as such.
 */
export class TracedCacheProvider implements CacheProvider {
  constructor(
    private readonly delegate: CacheProvider,
    private readonly tracer: TracingPort,
    private readonly system: string,
  ) {}

  async get<T>(key: string): Promise<T | null> {
    return this.tracer.withSpan(
      "cache.get",
      async (span) => {
        const value = await this.delegate.get<T>(key);
        span.setAttribute("cache.hit", value !== null);
        return value;
      },
      this.spanOptions(key),
    );
  }

  async set<T>(key: string, value: T, ttlMs: number): Promise<void> {
    return this.tracer.withSpan(
      "cache.set",
      () => this.delegate.set(key, value, ttlMs),
      this.spanOptions(key, { "cache.ttl_ms": ttlMs }),
    );
  }

  async delete(key: string): Promise<void> {
    return this.tracer.withSpan("cache.delete", () => this.delegate.delete(key), this.spanOptions(key));
  }

  async has(key: string): Promise<boolean> {
    return this.tracer.withSpan("cache.has", () => this.delegate.has(key), this.spanOptions(key));
  }

  async deletePattern(pattern: string): Promise<number> {
    return this.tracer.withSpan(
      "cache.delete_pattern",
      async (span) => {
        const removed = await this.delegate.deletePattern(pattern);
        span.setAttribute("cache.deleted_keys", removed);
        return removed;
      },
      // The pattern itself is low-cardinality by construction
      // (`prefix:namespace:*`) and is the whole point of the span, unlike
      // a concrete key — see `cacheKeyAttribute` below.
      { kind: "client", attributes: { "external.system": this.system, "cache.pattern": pattern } },
    );
  }

  private spanOptions(key: string, extra?: Record<string, string | number | boolean>) {
    return {
      kind: "client" as const,
      attributes: { "external.system": this.system, ...cacheKeyAttribute(key), ...extra },
    };
  }
}

/**
 * Records the *namespace* portion of the key, never the key itself.
 * `CacheKeyBuilder` keys embed entity ids (and, for the rate limiter, a
 * hashed client IP); a full key would both explode attribute cardinality
 * and put per-user identifiers into an externally-exported span, which is
 * the same line `logger.ts`'s redaction draws.
 */
function cacheKeyAttribute(key: string): Record<string, string> {
  const parts = key.split(":");
  return { "cache.namespace": parts.length > 1 ? parts.slice(0, -1).join(":") : key };
}

/** Wraps only when tracing is on — otherwise the provider is untouched. */
export function withCacheTracing(provider: CacheProvider, tracer: TracingPort, system: string): CacheProvider {
  return tracer.enabled ? new TracedCacheProvider(provider, tracer, system) : provider;
}
