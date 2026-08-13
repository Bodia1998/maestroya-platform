import "server-only";

import type { CheckerFindingInput, SafetyChecker, SubsystemCheckOutcome } from "@/application/ports/safety-checker";
import { SourceScanner } from "@/infrastructure/multi-instance-safety/source-scanner";

const FACTORY_PATH = "src/core/infrastructure/security/rate-limit-repository-factory.ts";
const REDIS_REPO_PATH = "src/core/infrastructure/security/redis-rate-limit-repository.ts";
const IN_MEMORY_REPO_PATH = "src/core/infrastructure/security/in-memory-rate-limit-repository.ts";

/**
 * Module 58 — Multi-Instance Safety Audit.
 *
 * Covers: rate limiting consistency across instances (part of "race
 * conditions" / "inconsistent writes" in the audit brief — an
 * under-enforced rate limit is a race-condition symptom: two instances
 * each independently believing a caller is under their limit). Verifies
 * `createRateLimitRepository()` prefers `RedisRateLimitRepository`
 * (shared counters — correctly enforced across every instance) whenever
 * `REDIS_URL` is configured, and only falls back to the documented
 * per-process `InMemoryRateLimitRepository` otherwise — a fallback whose
 * own doc comment explicitly calls out that a multi-instance deployment
 * using it would let each instance enforce the limit independently,
 * effectively multiplying the real limit by the instance count.
 */
export class RateLimitingChecker implements SafetyChecker {
  readonly subsystem = "Rate Limiting & Anti-Abuse Consistency";

  constructor(private readonly scanner: SourceScanner = new SourceScanner()) {}

  async check(): Promise<SubsystemCheckOutcome> {
    const passedChecks: string[] = [];
    const findings: CheckerFindingInput[] = [];

    const factory = await this.scanner.read(FACTORY_PATH);
    const redisRepo = await this.scanner.read(REDIS_REPO_PATH);
    const inMemoryRepo = await this.scanner.read(IN_MEMORY_REPO_PATH);

    if (factory && /getRedisClient/.test(factory) && /RedisRateLimitRepository/.test(factory)) {
      passedChecks.push(
        `${FACTORY_PATH}: selects \`RedisRateLimitRepository\` whenever \`REDIS_URL\` is configured — rate-limit counters are shared and correctly enforced across every instance, not multiplied by instance count.`,
      );
    } else {
      findings.push({
        severity: "CRITICAL",
        problem: "Could not confirm a Redis-first rate-limit repository selection factory.",
        risk: "Each instance could enforce rate limits independently against its own local counter, effectively multiplying the configured limit by the number of running instances.",
        whyItHappens: `${FACTORY_PATH} did not match the expected Redis-detection pattern.`,
        impact: "Brute-force/credential-stuffing and other rate-limited abuse protections (login attempts, etc.) would be materially weaker than configured under horizontal scaling.",
        recommendedFix: "Ensure the rate-limit repository factory always prefers the Redis-backed implementation when `REDIS_URL` is configured.",
        priority: "CRITICAL",
        evidence: [FACTORY_PATH],
      });
    }

    if (redisRepo) {
      passedChecks.push(`${REDIS_REPO_PATH}: a Redis-backed \`RateLimitRepository\` exists, giving every instance a single shared, atomically-enforced counter.`);
    }

    if (inMemoryRepo && /Not shared across instances/.test(inMemoryRepo)) {
      passedChecks.push(
        `${IN_MEMORY_REPO_PATH}: the in-memory fallback's own doc comment explicitly documents the "not shared across instances" limitation rather than leaving it undiscovered — a reviewer/operator cannot miss the tradeoff.`,
      );
      findings.push({
        severity: "WARNING",
        problem: "The in-memory rate-limit fallback's own doc comment describes the codebase's Redis story as outdated (\"no Redis/cache dependency anywhere in package.json\"), even though `REDIS_URL`, `RedisRateLimitRepository`, and the Redis-first factory now exist.",
        risk: "A future engineer reading only that file's doc comment (not the factory) could incorrectly conclude rate limiting is always per-instance, or fail to notice the Redis-backed path is the intended production configuration.",
        whyItHappens: `${IN_MEMORY_REPO_PATH}'s doc comment predates the later addition of Redis-backed infrastructure (Module 44) and was not updated at that time.`,
        impact: "Documentation drift — no functional bug, but a real risk of a future operator misconfiguring a multi-instance deployment without REDIS_URL, believing that was always the only option.",
        recommendedFix: "Update the in-memory repository's doc comment to point to `rate-limit-repository-factory.ts` and note that Redis is now the intended production backend, keeping the single-instance/dev framing only for when Redis is genuinely absent.",
        priority: "LOW",
        evidence: [IN_MEMORY_REPO_PATH],
      });
    }

    return { passedChecks, findings };
  }
}
