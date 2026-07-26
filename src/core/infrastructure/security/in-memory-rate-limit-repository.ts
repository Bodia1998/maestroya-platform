import type {
  RateLimitDecision,
  RateLimitRepository,
} from "@/domain/repositories/rate-limit-repository";
import { computeRateLimit, type RateLimitWindowState } from "@/domain/services/rate-limit-window";

/**
 * Security & Anti-Abuse module (Module 24): the only `RateLimitRepository`
 * implementation wired up today. Backed by a plain in-process `Map` —
 * correct and sufficient for this codebase's actual deployment shape
 * (single Next.js instance, no Redis/cache dependency anywhere in
 * package.json) and for dev/tests, but has two known limitations, both
 * called out explicitly rather than silently accepted:
 *
 *  1. **Not shared across instances.** A multi-instance/serverless
 *     deployment (Module 25 — Production Infrastructure) would let each
 *     instance enforce the limit independently, effectively multiplying
 *     the real limit by the instance count. Swapping in a Redis-backed
 *     `RateLimitRepository` (INCR + PEXPIRE, or a small Lua script for
 *     atomicity) behind this same interface — no caller changes — is the
 *     intended fix; see docs/MODULE_24_SECURITY_ANTI_ABUSE.md.
 *  2. **Not durable.** A process restart silently resets every bucket.
 *     Acceptable for rate limiting (a temporary safety net, not a ledger)
 *     but worth knowing.
 *
 * The `Map` read-modify-write in `consume` below is not atomic under true
 * parallel access (two concurrent calls for the same key could both read
 * the same "count so far" before either writes back) — a real race, but a
 * benign one for this module's purpose (worst case, a couple of extra
 * requests squeak through right at the boundary of the limit; it can
 * never *undercount* and block something that should have been allowed).
 * A Redis Lua script or `INCR` closes this gap when Module 25 swaps the
 * backend.
 *
 * Known limitation (documented, not silently accepted): expired buckets
 * are only ever overwritten on their key's *next* `consume` call, never
 * proactively swept — a key that's rate-limited once and never used again
 * stays in the Map. Bounded in practice by this module's own key space
 * (per-user/per-IP-hash keys for a handful of named policies — see
 * rate-limit-policies.ts), and a process restart clears it entirely, but a
 * real background sweep (or the Module 25 Redis swap, where TTL-based
 * expiry is native) is the real fix for long-lived, high-traffic
 * deployments.
 */
export class InMemoryRateLimitRepository implements RateLimitRepository {
  private readonly buckets = new Map<string, RateLimitWindowState>();

  async consume(
    key: string,
    limit: number,
    windowMs: number,
    now: Date,
  ): Promise<RateLimitDecision> {
    const previous = this.buckets.get(key);
    const result = computeRateLimit(previous, limit, windowMs, now.getTime());
    this.buckets.set(key, result.nextState);

    return {
      allowed: result.allowed,
      limit,
      remaining: result.remaining,
      retryAfterMs: result.retryAfterMs,
    };
  }

  async reset(key: string): Promise<void> {
    this.buckets.delete(key);
  }
}
