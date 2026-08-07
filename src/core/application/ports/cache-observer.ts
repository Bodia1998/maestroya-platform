/**
 * Module 46 — Caching Layer (Roadmap Module 13).
 *
 * Observability seam for the caching layer, same "port an application-
 * layer orchestrator depends on, infrastructure implements against a
 * real transport" shape as `FailureReporter`/`ErrorReporter`
 * (application/ports) and their Sentry/console-backed implementations in
 * `infrastructure/observability/`. `CacheManager` (application layer)
 * must not import `logger`/`createErrorReporter` directly — those are
 * infrastructure concerns — so it depends on this interface instead, and
 * `infrastructure/cache/cache-observability.ts` supplies the concrete,
 * logger-backed implementation wired in by `infrastructure/cache/compose.ts`,
 * mirroring exactly how Module 45's `JobLifecycleObserver` is consumed by
 * `Queue`/`Worker`.
 *
 * Every method is a void, fire-and-forget notification — a caching layer
 * observer must never be able to throw and interrupt the cache operation
 * it's reporting on.
 */
export interface CacheOperationEvent {
  readonly namespace: string;
  readonly key: string;
}

export type CacheInvalidationScope = "key" | "namespace" | "pattern" | "version";

export interface CacheInvalidationEvent {
  readonly namespace: string;
  readonly scope: CacheInvalidationScope;
  /** Pattern or key that was invalidated, for diagnostics. */
  readonly target: string;
  /** Number of keys actually removed (0 is valid — nothing matched). */
  readonly count: number;
}

export interface CacheErrorEvent {
  readonly operation: "get" | "set" | "delete" | "has" | "deletePattern";
  readonly namespace?: string;
  readonly key?: string;
  readonly error: unknown;
}

export interface CacheObserver {
  onHit(event: CacheOperationEvent): void;
  onMiss(event: CacheOperationEvent): void;
  onSet(event: CacheOperationEvent & { ttlMs: number }): void;
  onDelete(event: CacheOperationEvent): void;
  onInvalidate(event: CacheInvalidationEvent): void;
  onError(event: CacheErrorEvent): void;
}

/**
 * A no-op observer — same "null object beats an optional callback"
 * convention as Module 45's `nullJobLifecycleObserver`. The default for
 * `CacheManager` when no observer is supplied (e.g. in unit tests), and
 * usable directly by any caller that wants a cache with no telemetry at
 * all.
 */
export const nullCacheObserver: CacheObserver = {
  onHit() {},
  onMiss() {},
  onSet() {},
  onDelete() {},
  onInvalidate() {},
  onError() {},
};
