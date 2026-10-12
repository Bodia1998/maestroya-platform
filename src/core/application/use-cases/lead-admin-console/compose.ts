import {
  GetAdminAbuseSubjectUseCase,
  GetAdminLeadDetailUseCase,
  ListAdminLeadClaimsUseCase,
  ListAdminLeadDisputesUseCase,
  ListAdminLeadsUseCase,
} from "@/application/use-cases/lead-admin-console/lead-admin-console.use-cases";
import { PrismaAdminRepository } from "@/infrastructure/database/prisma/repositories/prisma-admin-repository";
import { PrismaLeadAdminConsoleReader } from "@/infrastructure/database/prisma/repositories/prisma-lead-admin-console-reader";

/**
 * Module 157 — composition root of the Lead Admin Operations Console READ side (plain factories, no DI container).
 *
 * Only reads live here. The console's mutations are NOT re-implemented: its Server Actions call the existing M154 / M155 / M156
 * composition roots (`lead-quality-claim`, `lead-fee-dispute`, `lead-abuse`), so those modules stay the single source of truth for
 * their state machines, separation of duties, concurrency control and atomic audit.
 */
const admins = new PrismaAdminRepository();
const reader = new PrismaLeadAdminConsoleReader();

export const makeListAdminLeadsUseCase = () => new ListAdminLeadsUseCase(admins, reader);
export const makeGetAdminLeadDetailUseCase = () => new GetAdminLeadDetailUseCase(admins, reader);
export const makeListAdminLeadClaimsUseCase = () => new ListAdminLeadClaimsUseCase(admins, reader);
export const makeListAdminLeadDisputesUseCase = () => new ListAdminLeadDisputesUseCase(admins, reader);
export const makeGetAdminAbuseSubjectUseCase = () => new GetAdminAbuseSubjectUseCase(admins, reader);
