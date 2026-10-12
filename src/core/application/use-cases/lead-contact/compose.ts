import { observeLeadContactAccess } from "@/application/use-cases/lead-abuse/compose";
import { GetLeadContactUseCase } from "@/application/use-cases/lead-contact/get-lead-contact.use-case";
import {
  PrismaLeadContactAuthorizationReader,
  PrismaLeadContactReader,
} from "@/infrastructure/database/prisma/repositories/prisma-lead-contact-access-repository";
import { PrismaProfessionalRepository } from "@/infrastructure/database/prisma/repositories/prisma-professional-repository";
import { PrismaUserRepository } from "@/infrastructure/database/prisma/repositories/prisma-user-repository";

/**
 * Module 138 — composition root for the ONE application path to private lead
 * contact data (same plain-factory convention as lead/compose.ts). Entry points
 * must pass the SESSION user id; nothing else is accepted as identity.
 */
export function makeGetLeadContactUseCase() {
  // Module 156: when (and only when) LEAD_ABUSE_CONTROL_MODE is on, denials are OBSERVED (a probing signal is recorded). The
  // wrapper can neither grant nor deny; OFF (default) returns the use case itself, unchanged.
  return observeLeadContactAccess(
    new GetLeadContactUseCase(
      new PrismaUserRepository(),
      new PrismaProfessionalRepository(),
      new PrismaLeadContactAuthorizationReader(),
      new PrismaLeadContactReader(),
    ),
  );
}
