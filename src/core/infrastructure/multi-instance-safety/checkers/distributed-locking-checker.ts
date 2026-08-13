import "server-only";

import type { CheckerFindingInput, SafetyChecker, SubsystemCheckOutcome } from "@/application/ports/safety-checker";
import { SourceScanner } from "@/infrastructure/multi-instance-safety/source-scanner";

const REDIS_LOCK_PATH = "src/core/infrastructure/locking/redis-lock-service.ts";
const IN_MEMORY_LOCK_PATH = "src/core/infrastructure/locking/in-memory-lock-service.ts";
const LOCK_FACTORY_PATH = "src/core/infrastructure/locking/lock-service-factory.ts";
const DISTRIBUTED_LOCK_PORT_PATH = "src/core/application/ports/distributed-lock.ts";

/**
 * Module 58 — Multi-Instance Safety Audit.
 *
 * Covers: distributed locking, deadlock detection/avoidance. Verifies
 * `RedisLockService` acquires with an atomic `SET key token PX ttl NX`
 * (race-free acquisition — Redis serializes commands from all clients, so
 * two instances can never both win) and releases only via a check-and-delete
 * Lua script comparing a per-acquisition token (never a blind `DEL`, which
 * would let a slow holder's late release delete a different instance's
 * lock acquired after TTL expiry — the classic distributed-lock bug this
 * codebase's own `RedisLockService` doc comment calls out by name).
 * Verifies every acquisition takes a bounded `ttlMs` (no lock can be held
 * forever, so a crashed holder can never deadlock every other instance
 * out of the resource permanently) and that a factory selects the
 * Redis-backed implementation whenever `REDIS_URL` is configured rather
 * than always using the single-process fallback.
 */
export class DistributedLockingChecker implements SafetyChecker {
  readonly subsystem = "Distributed Locking & Deadlock Avoidance";

  constructor(private readonly scanner: SourceScanner = new SourceScanner()) {}

  async check(): Promise<SubsystemCheckOutcome> {
    const passedChecks: string[] = [];
    const findings: CheckerFindingInput[] = [];

    const redisLock = await this.scanner.read(REDIS_LOCK_PATH);
    if (redisLock && /SET.*NX/.test(redisLock)) {
      passedChecks.push(`${REDIS_LOCK_PATH}: lock acquisition uses an atomic \`SET ... NX\` — cannot race across instances.`);
    } else {
      findings.push({
        severity: "CRITICAL",
        problem: "No atomic NX-based lock acquisition found in the Redis lock implementation.",
        risk: "Two instances could both believe they hold the same lock simultaneously.",
        whyItHappens: `${REDIS_LOCK_PATH} did not contain the expected \`SET key value PX ttl NX\` acquisition pattern.`,
        impact: "Any code relying on `DistributedLock.withLock` for mutual exclusion (e.g. a critical section touched by a background job) could run concurrently on two instances.",
        recommendedFix: "Acquire the lock via a single atomic `SET key token PX ttlMs NX` Redis command, never a separate EXISTS+SET pair.",
        priority: "CRITICAL",
        evidence: [REDIS_LOCK_PATH],
      });
    }

    if (redisLock && /EVAL/.test(redisLock) && /GET.*KEYS\[1\].*ARGV\[1\]/s.test(redisLock)) {
      passedChecks.push(
        `${REDIS_LOCK_PATH}: release is a token-checked Lua script (compare-then-delete), not a blind DEL — a holder past its own TTL can never delete a different holder's re-acquired lock.`,
      );
    } else {
      findings.push({
        severity: "WARNING",
        problem: "Lock release does not clearly verify ownership before deleting the lock key.",
        risk: "A holder whose work outlives the lock's TTL could delete a lock a different instance legitimately re-acquired in the meantime.",
        whyItHappens: `${REDIS_LOCK_PATH} did not match the expected token-compare Lua-script release pattern.`,
        impact: "Mutual exclusion could be silently broken under slow/overloaded conditions — exactly when a lock matters most.",
        recommendedFix: "Release only via an atomic compare-and-delete (Lua EVAL comparing a stored per-acquisition token) rather than an unconditional DEL.",
        priority: "HIGH",
        evidence: [REDIS_LOCK_PATH],
      });
    }

    if (redisLock && /ttlMs\s*<=\s*0/.test(redisLock)) {
      passedChecks.push(`${REDIS_LOCK_PATH}: rejects a non-positive TTL — every lock acquisition is bounded, ruling out an unbounded/forever-held lock.`);
    }

    const factory = await this.scanner.read(LOCK_FACTORY_PATH);
    const inMemory = await this.scanner.read(IN_MEMORY_LOCK_PATH);
    if (factory && /getRedisClient/.test(factory) && /RedisLockService/.test(factory)) {
      passedChecks.push(`${LOCK_FACTORY_PATH}: selects \`RedisLockService\` whenever a Redis client is configured, falling back to the in-process implementation only otherwise.`);
    } else {
      findings.push({
        severity: "WARNING",
        problem: "Could not statically confirm a Redis-first selection factory for the distributed lock.",
        risk: "A deployment with REDIS_URL configured could still end up using the single-process lock implementation, which cannot coordinate across instances.",
        whyItHappens: `${LOCK_FACTORY_PATH} did not match the expected Redis-detection pattern.`,
        impact: "Locking would silently degrade to per-instance mutual exclusion only, defeating its purpose under horizontal scaling.",
        recommendedFix: "Ensure the lock service factory always prefers the Redis-backed implementation when a Redis client is available, and only falls back to the in-memory one otherwise.",
        priority: "HIGH",
        evidence: [LOCK_FACTORY_PATH],
      });
    }

    if (inMemory) {
      findings.push({
        severity: "WARNING",
        problem: "An in-process (single-instance-only) `DistributedLock` implementation exists and is reachable without `REDIS_URL` configured.",
        risk: "If REDIS_URL is left unset in a multi-instance production deployment, mutual exclusion silently becomes per-instance only — two instances could both proceed through a supposedly-locked critical section.",
        whyItHappens: `${IN_MEMORY_LOCK_PATH} exists as the documented local-dev/single-instance fallback (see the port at ${DISTRIBUTED_LOCK_PORT_PATH}); nothing at deploy time enforces that REDIS_URL is actually set once more than one instance is running.`,
        impact: "A misconfigured multi-instance deployment (missing REDIS_URL) would pass every functional test yet silently lose cross-instance mutual exclusion.",
        recommendedFix: "Add a startup/health-check assertion (e.g. in the readiness route) that fails loudly when running with more than one expected instance but no REDIS_URL configured, rather than silently degrading.",
        priority: "MEDIUM",
        evidence: [IN_MEMORY_LOCK_PATH, LOCK_FACTORY_PATH],
      });
    }

    return { passedChecks, findings };
  }
}
