import type { CacheNamespace } from "@/application/services/cache/cache-namespace";
import type { AnalyticsReadModelStore } from "@/application/ports/analytics-read-model-store";
import type { AnalyticsDashboardSnapshot } from "@/domain/entities/analytics-dashboard";

const SNAPSHOT_KEY = ["dashboard", "current"] as const;

/** The JSON-safe wire shape stored in the cache — `Date` fields become
 *  ISO strings, exactly like `event-job-serializer.ts` does for a domain
 *  event's own `occurredAt` before it crosses a storage boundary. */
interface StoredSnapshot {
  data: AnalyticsDashboardSnapshot["data"];
  computedAt: string;
  source: AnalyticsDashboardSnapshot["source"];
  degraded: boolean;
}

/**
 * Module 50 — Analytics Dashboard (CQRS Read Model).
 *
 * The one production `AnalyticsReadModelStore` implementation, backed by
 * Module 46's `CacheNamespace` — the "actual store" the port's own doc
 * comment describes. Reuses `CacheManager`'s existing Redis-or-in-memory
 * fallback, versioning, and statistics wholesale; this class adds nothing
 * beyond the key shape and the `Date` (de)serialization a raw
 * `CacheProvider` round trip needs.
 */
export class CacheAnalyticsReadModelStore implements AnalyticsReadModelStore {
  constructor(private readonly cache: CacheNamespace) {}

  async get(): Promise<AnalyticsDashboardSnapshot | null> {
    const stored = await this.cache.get<StoredSnapshot>(SNAPSHOT_KEY);
    if (!stored) return null;
    return { ...stored, computedAt: new Date(stored.computedAt) };
  }

  async set(snapshot: AnalyticsDashboardSnapshot, ttlMs: number): Promise<void> {
    const stored: StoredSnapshot = {
      data: snapshot.data,
      computedAt: snapshot.computedAt.toISOString(),
      source: snapshot.source,
      degraded: snapshot.degraded,
    };
    await this.cache.set(SNAPSHOT_KEY, stored, ttlMs);
  }

  async invalidate(): Promise<void> {
    await this.cache.delete(SNAPSHOT_KEY);
  }
}
