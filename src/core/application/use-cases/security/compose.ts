import { createRateLimitRepository } from "@/infrastructure/security/rate-limit-repository-factory";
import type { RateLimitRepository } from "@/domain/repositories/rate-limit-repository";
import { PrismaAccountRestrictionRepository } from "@/infrastructure/database/prisma/repositories/prisma-account-restriction-repository";
import { PrismaSecurityEventRepository } from "@/infrastructure/database/prisma/repositories/prisma-security-event-repository";
import { AntiAbuseService } from "@/application/services/anti-abuse-service";
import { CreateAccountRestrictionUseCase } from "@/application/use-cases/security/create-account-restriction.use-case";
import { LiftAccountRestrictionUseCase } from "@/application/use-cases/security/lift-account-restriction.use-case";
import { ListAccountRestrictionsUseCase } from "@/application/use-cases/security/list-account-restrictions.use-case";
import { ListSecurityEventsUseCase } from "@/application/use-cases/security/list-security-events.use-case";

/**
 * Manual composition root — same "no DI container" convention as every
 * other module's compose.ts (see application/use-cases/auth/compose.ts).
 *
 * `rateLimits` is a module-level singleton (not re-constructed per
 * request) — its whole purpose is to remember state *across* requests
 * within this process; a fresh instance per call would make it a no-op.
 *
 * Module 44 — Redis Infrastructure: `createRateLimitRepository()`
 * (infrastructure/security/rate-limit-repository-factory.ts) is now the
 * single place deciding in-memory vs. Redis-backed — this line itself no
 * longer changes when that backend changes. See
 * `InMemoryRateLimitRepository`'s and `RedisRateLimitRepository`'s own
 * doc comments for the multi-instance caveat this factory resolves.
 *
 * Module 82 finalization — Production Build Failure fix: `rateLimits`
 * used to be constructed eagerly at module-import time (`const rateLimits
 * = createRateLimitRepository()` evaluated the instant this file was
 * first imported). `next build` forces `NODE_ENV=production` for the
 * build itself (see `env.ts`'s own comment on `NEXT_PHASE`) while
 * collecting page data for every route — including `/api/auth/[...nextauth]`
 * (`auth-config.ts` -> `makeAntiAbuseService()` -> this module) — which
 * merely *imports* this module to inspect route metadata, without ever
 * invoking `makeAntiAbuseService()`. Eager construction meant that import
 * alone ran `createRateLimitRepository()`'s production fail-closed check
 * (`rate-limit-repository-factory.ts`) with a real production `NODE_ENV`
 * but no `REDIS_URL` yet configured for the build environment, throwing
 * and failing the build outright.
 *
 * The fix is initialization timing only, not the security check itself:
 * `rateLimits` is now a lazily-memoized singleton — the exact same
 * memoization pattern `createRateLimitRepository()` already uses
 * internally — constructed on first actual call to `makeAntiAbuseService()`
 * (i.e. when a real request is served), never merely on import. A
 * genuine production *runtime* request still hits
 * `createRateLimitRepository()` the first time `makeAntiAbuseService()`
 * runs and still throws immediately if `REDIS_URL` is missing — the
 * "production + missing Redis -> fail closed" invariant is completely
 * unchanged. Only the moment of construction moved from "module import"
 * to "first real use".
 */
let rateLimitsInstance: RateLimitRepository | null = null;
function getRateLimits(): RateLimitRepository {
  if (!rateLimitsInstance) {
    rateLimitsInstance = createRateLimitRepository();
  }
  return rateLimitsInstance;
}
const securityEvents = new PrismaSecurityEventRepository();
const accountRestrictions = new PrismaAccountRestrictionRepository();

export function makeAntiAbuseService(): AntiAbuseService {
  return new AntiAbuseService(getRateLimits(), securityEvents, accountRestrictions);
}

export function makeListSecurityEventsUseCase() {
  return new ListSecurityEventsUseCase(securityEvents);
}

export function makeListAccountRestrictionsUseCase() {
  return new ListAccountRestrictionsUseCase(accountRestrictions);
}

export function makeCreateAccountRestrictionUseCase() {
  return new CreateAccountRestrictionUseCase(accountRestrictions, securityEvents);
}

export function makeLiftAccountRestrictionUseCase() {
  return new LiftAccountRestrictionUseCase(accountRestrictions, securityEvents);
}
