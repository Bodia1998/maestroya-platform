import "server-only";

import type { CheckerFindingInput, SafetyChecker, SubsystemCheckOutcome } from "@/application/ports/safety-checker";
import { SourceScanner } from "@/infrastructure/multi-instance-safety/source-scanner";

const CACHE_SERVICE_PORT_PATH = "src/core/application/ports/cache-service.ts";
const REDIS_CACHE_PATH = "src/core/infrastructure/cache/redis-cache-service.ts";
const IN_MEMORY_CACHE_PATH = "src/core/infrastructure/cache/in-memory-cache-service.ts";
const CACHE_FACTORY_PATH = "src/core/infrastructure/cache/cache-service-factory.ts";

/**
 * Module 58 — Multi-Instance Safety Audit.
 *
 * Covers: cache invalidation, Redis consistency, stale cache reads across
 * instances. `CacheService` (Module 44) is a swappable port with two
 * implementations: `RedisCacheService` (shared, consistent across every
 * instance — a write on instance A is immediately visible to a read on
 * instance B) and `InMemoryCacheService` (single-process, always
 * available, zero configuration). This checker verifies the factory
 * prefers Redis whenever configured, and that every `set()` call is
 * required to carry an explicit TTL (an unbounded, never-invalidated
 * cache entry is exactly the shape of bug that produces "instance B never
 * sees the update" — a TTL bounds how stale a read can ever be, even if
 * an explicit invalidation is missed somewhere).
 */
export class CacheConsistencyChecker implements SafetyChecker {
  readonly subsystem = "Caching & Redis Consistency";

  constructor(private readonly scanner: SourceScanner = new SourceScanner()) {}

  async check(): Promise<SubsystemCheckOutcome> {
    const passedChecks: string[] = [];
    const findings: CheckerFindingInput[] = [];

    const port = await this.scanner.read(CACHE_SERVICE_PORT_PATH);
    if (port && /ttlMs.*required/i.test(port.replace(/\s+/g, " "))) {
      passedChecks.push(`${CACHE_SERVICE_PORT_PATH}: \`CacheService.set\` requires an explicit \`ttlMs\` — no cache entry can be unbounded, which caps how stale a read on another instance can ever become even if an explicit invalidation is missed.`);
    } else if (port) {
      findings.push({
        severity: "WARNING",
        problem: "Could not confirm the cache port requires a mandatory TTL on writes.",
        risk: "A cache entry with no expiry could remain stale indefinitely on one instance after being invalidated/updated via another, if an explicit `delete()` call is ever missed.",
        whyItHappens: `${CACHE_SERVICE_PORT_PATH} did not document \`ttlMs\` as required.`,
        impact: "Stale reads with no natural self-healing bound.",
        recommendedFix: "Require an explicit TTL on every cache write at the port level, so staleness is always bounded even when explicit invalidation is missed.",
        priority: "MEDIUM",
        evidence: [CACHE_SERVICE_PORT_PATH],
      });
    }

    const factory = await this.scanner.read(CACHE_FACTORY_PATH);
    const redisCache = await this.scanner.read(REDIS_CACHE_PATH);
    const inMemoryCache = await this.scanner.read(IN_MEMORY_CACHE_PATH);

    if (factory && /getRedisClient/.test(factory) && /RedisCacheService/.test(factory)) {
      passedChecks.push(`${CACHE_FACTORY_PATH}: selects \`RedisCacheService\` (shared, cross-instance-consistent) whenever a Redis client is configured.`);
    } else {
      findings.push({
        severity: "CRITICAL",
        problem: "Could not confirm a Redis-first cache selection factory.",
        risk: "Under horizontal scaling, each instance could maintain its own independent in-memory cache — a write invalidated/updated on instance A would remain visible (stale) to reads on instance B indefinitely, until that entry's local TTL happens to expire.",
        whyItHappens: `${CACHE_FACTORY_PATH} did not match the expected Redis-detection pattern.`,
        impact: "Users could see inconsistent data (e.g. a just-updated professional profile) depending on which instance served their request.",
        recommendedFix: "Ensure the cache-service factory always prefers `RedisCacheService` when `REDIS_URL` is configured, exactly like the lock and rate-limit factories.",
        priority: "CRITICAL",
        evidence: [CACHE_FACTORY_PATH],
      });
    }

    if (redisCache) {
      passedChecks.push(`${REDIS_CACHE_PATH}: a Redis-backed \`CacheService\` implementation exists, giving every instance a single shared, consistent view of cached data.`);
    }
    if (inMemoryCache) {
      findings.push({
        severity: "WARNING",
        problem: "An in-memory (single-process) `CacheService` implementation is reachable without Redis configured.",
        risk: "If REDIS_URL is unset in a multi-instance deployment, each instance silently caches independently — cache invalidation on one instance never propagates to another.",
        whyItHappens: `${IN_MEMORY_CACHE_PATH} exists as the documented local-dev/single-instance fallback; nothing prevents it from being used unintentionally in a misconfigured multi-instance production deployment.`,
        impact: "Stale reads that never self-correct except via each instance's own TTL expiry — worse than a single shared TTL, since instances can disagree for up to a full TTL window after every write.",
        recommendedFix: "Add a startup/readiness assertion that a multi-instance deployment always has REDIS_URL configured before it's allowed to serve traffic that depends on cache consistency.",
        priority: "MEDIUM",
        evidence: [IN_MEMORY_CACHE_PATH, CACHE_FACTORY_PATH],
      });
    }

    return { passedChecks, findings };
  }
}
