import { InMemoryRateLimitRepository } from "@/infrastructure/security/in-memory-rate-limit-repository";
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
 * See InMemoryRateLimitRepository's own doc comment for the multi-instance
 * caveat this implies.
 */
const rateLimits = new InMemoryRateLimitRepository();
const securityEvents = new PrismaSecurityEventRepository();
const accountRestrictions = new PrismaAccountRestrictionRepository();

export function makeAntiAbuseService(): AntiAbuseService {
  return new AntiAbuseService(rateLimits, securityEvents, accountRestrictions);
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
