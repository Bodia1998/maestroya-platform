import type { AnalyticsDashboardSnapshot } from "@/domain/entities/analytics-dashboard";

/**
 * Module 50 — Analytics Dashboard (CQRS Read Model).
 *
 * The technology-agnostic seam between the analytics read side and
 * wherever the materialized dashboard actually lives — this module's
 * analogue of Module 47's `SearchIndexProvider` and Module 46's
 * `CacheProvider` itself. Application code (the use cases in
 * `application/use-cases/analytics-dashboard/`) depends only on this
 * interface; it never imports `CacheManager`/`CacheNamespace` or any
 * Redis/in-memory detail directly.
 *
 * Deliberately not a bare `CacheNamespace` injected straight into the use
 * cases: Module 46's own `CacheNamespace` is generic over cache-shaped
 * concerns (namespaces, TTL, versioning, bypass) that a read-model store
 * has no business exposing to its callers, and a dedicated port keeps
 * this module swappable onto a different materialization strategy later
 * (a dedicated table, a Redis hash with per-field TTLs, ...) the same way
 * `SearchIndexProvider` keeps Module 47 swappable across search engines.
 * The one production implementation
 * (`infrastructure/analytics/cache-analytics-read-model-store.ts`) is, in
 * fact, backed by `CacheNamespace` — this is a dependency-inversion seam,
 * not evidence that a second storage technology is planned.
 *
 * There is exactly one artifact behind this port — the current dashboard
 * snapshot — so the surface is smaller than `SearchIndexProvider`'s
 * (no id-keyed CRUD, no query DSL): `get`/`set`/`invalidate` on a single,
 * implicit key.
 */
export interface AnalyticsReadModelStore {
  /** Returns the currently stored snapshot, or `null` on a cache miss
   *  (never populated yet, evicted, or expired). Must not throw for a
   *  miss — only for a genuine backend failure, which callers treat as a
   *  miss anyway (see `GetDashboardAnalyticsUseCase`). */
  get(): Promise<AnalyticsDashboardSnapshot | null>;

  /** Stores `snapshot`, replacing whatever was there. `ttlMs` bounds how
   *  long a stale-but-present snapshot may keep being served before the
   *  next read forces a recompute. */
  set(snapshot: AnalyticsDashboardSnapshot, ttlMs: number): Promise<void>;

  /** Explicitly evicts the stored snapshot — the operator/rebuild escape
   *  hatch, mirroring `CacheNamespace.invalidateAll()`. */
  invalidate(): Promise<void>;
}
