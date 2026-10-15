import { leadRequestCategoryPolicyFrom } from "@/domain/services/lead-request-category-support";
import { PrismaLeadRequestCategoryRepository } from "@/infrastructure/database/prisma/repositories/prisma-lead-request-category-repository";
import { resolveLeadPublicationConfiguration } from "@/application/use-cases/lead-publication/compose";
import { getLeadRolloutStatus } from "@/application/use-cases/lead-rollout/compose";
import { NewRequestFlowSelector } from "@/application/use-cases/new-request-flow/new-request-flow-selector";

/**
 * Module 165 - composition root of the new-request flow selection (plain factory, no DI container).
 *
 * No new configuration is read here: the ENTRY area comes from the M159 status read (`LEAD_V1_ROLLOUT_MODE`, per call, never
 * throws, fails to DISABLED) and the category policy from the M132 resolution (`resolveLeadPublicationConfiguration`, per call).
 */
const categories = new PrismaLeadRequestCategoryRepository();

export function makeNewRequestFlowSelector() {
  return new NewRequestFlowSelector(
    categories,
    () => leadRequestCategoryPolicyFrom(resolveLeadPublicationConfiguration()),
    () => getLeadRolloutStatus().entryOpen,
  );
}
