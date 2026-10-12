import type { AntiAbuseService } from "@/application/services/anti-abuse-service";
import {
  ImposeLeadAbuseBlockUseCase,
  LiftLeadAbuseDecisionUseCase,
  ListOpenLeadAbuseFlagsUseCase,
} from "@/application/use-cases/lead-abuse/admin-lead-abuse.use-cases";
import { EvaluateLeadAbuseUseCase } from "@/application/use-cases/lead-abuse/evaluate-lead-abuse.use-case";
import {
  LeadAbuseGuardedInitiatePurchase,
  LeadAbuseGuardedPublishLead,
  LeadAbuseObservedGetLeadContact,
  LeadAbuseRuntime,
} from "@/application/use-cases/lead-abuse/lead-abuse-guards";
import { makeAntiAbuseService } from "@/application/use-cases/security/compose";
import { loadLeadAbuseControlConfig } from "@/infrastructure/config/lead-abuse-control-config";
import type { LeadAbuseControlConfig } from "@/domain/services/lead-abuse-controls";
import { PrismaAdminRepository } from "@/infrastructure/database/prisma/repositories/prisma-admin-repository";
import { PrismaLeadAbuseControlRepository, PrismaLeadAbuseFactsReader } from "@/infrastructure/database/prisma/repositories/prisma-lead-abuse-control-repository";

/**
 * Module 156 — composition root of the lead fraud & abuse controls (plain factories, no DI container).
 *
 * The three `guard*` functions are the ONLY places the controls attach to the application. Each one returns the wrapped use case
 * UNCHANGED (the very same object) when the rollout mode is OFF — the default — so a deployment that has not opted in executes
 * exactly the pre-M156 code path, with no extra read or write. The mode is read from the environment on every call.
 *
 * The administrative use cases (impose / lift / review queue) have NO caller yet (no route, Server Action or admin UI): they
 * re-validate the administrator themselves, and the M157 admin console must still gate with requireRole(ADMIN, SUPER_ADMIN).
 */
const control = new PrismaLeadAbuseControlRepository();
const facts = new PrismaLeadAbuseFactsReader();
const admins = new PrismaAdminRepository();

type Executable<R> = { execute(userId: string, leadId: string): Promise<R> };

function makeRuntime(config: LeadAbuseControlConfig, antiAbuse: Pick<AntiAbuseService, "enforceRateLimit"> | null): LeadAbuseRuntime {
  return new LeadAbuseRuntime(config.mode, new EvaluateLeadAbuseUseCase(facts, control, config), control, antiAbuse);
}

export function makeEvaluateLeadAbuseUseCase(config: LeadAbuseControlConfig = loadLeadAbuseControlConfig()) {
  return new EvaluateLeadAbuseUseCase(facts, control, config);
}

export function guardLeadPublication<R>(inner: Executable<R>, config: LeadAbuseControlConfig = loadLeadAbuseControlConfig()): Executable<R> {
  if (config.mode === "OFF") return inner;
  return new LeadAbuseGuardedPublishLead(inner, makeRuntime(config, config.mode === "ENFORCE" ? makeAntiAbuseService() : null));
}

export function guardLeadPurchaseInitiation<R>(inner: Executable<R>, config: LeadAbuseControlConfig = loadLeadAbuseControlConfig()): Executable<R> {
  if (config.mode === "OFF") return inner;
  return new LeadAbuseGuardedInitiatePurchase(inner, makeRuntime(config, config.mode === "ENFORCE" ? makeAntiAbuseService() : null));
}

export function observeLeadContactAccess<R>(inner: Executable<R>, config: LeadAbuseControlConfig = loadLeadAbuseControlConfig()): Executable<R> {
  if (config.mode === "OFF") return inner;
  return new LeadAbuseObservedGetLeadContact(inner, makeRuntime(config, null));
}

export function makeImposeLeadAbuseBlockUseCase() {
  return new ImposeLeadAbuseBlockUseCase(admins, control);
}

export function makeLiftLeadAbuseDecisionUseCase() {
  return new LiftLeadAbuseDecisionUseCase(admins, control);
}

export function makeListOpenLeadAbuseFlagsUseCase() {
  return new ListOpenLeadAbuseFlagsUseCase(admins, control);
}
