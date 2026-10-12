import { leadRequestCategoryPolicyFrom } from "@/domain/services/lead-request-category-support";
import { PrismaLeadRequestCategoryRepository } from "@/infrastructure/database/prisma/repositories/prisma-lead-request-category-repository";
import { makeCreateLeadV1ServiceRequestUseCase } from "@/application/use-cases/lead/compose";
import { makePublishLeadUseCase, resolveLeadPublicationConfiguration } from "@/application/use-cases/lead-publication/compose";
import { ListLeadRequestCategoriesUseCase } from "@/application/use-cases/lead-request/list-lead-request-categories.use-case";
import { SubmitLeadRequestUseCase } from "@/application/use-cases/lead-request/submit-lead-request.use-case";
import { makeRecordLeadContactSharingUseCase } from "@/application/use-cases/lead-privacy/compose";
import { PrismaServiceRequestRepository } from "@/infrastructure/database/prisma/repositories/prisma-service-request-repository";
import { loadLeadPrivacyConfig } from "@/infrastructure/config/lead-privacy-config";

/**
 * Module 142 — composition root for the customer LEAD_V1 request UI. The
 * supported-category policy is derived from the SAME Module 132 resolution the
 * publication contract uses (via lead-publication/compose), so the picker, the
 * server-side check and publication can never disagree about what is supported.
 * Not a valid configuration => nothing is offered or accepted (fail closed).
 */
const categories = new PrismaLeadRequestCategoryRepository();

type Configuration = ReturnType<typeof resolveLeadPublicationConfiguration>;

export function makeListLeadRequestCategoriesUseCase(configuration: Configuration = resolveLeadPublicationConfiguration()) {
  return new ListLeadRequestCategoriesUseCase(categories, leadRequestCategoryPolicyFrom(configuration));
}

export function makeSubmitLeadRequestUseCase(configuration: Configuration = resolveLeadPublicationConfiguration()) {
  return new SubmitLeadRequestUseCase(
    categories,
    leadRequestCategoryPolicyFrom(configuration),
    makeCreateLeadV1ServiceRequestUseCase(),
    makePublishLeadUseCase(configuration),
    // Module 158: contact-sharing evidence capture (policy from configuration; inert while the lawful basis is undecided).
    {
      policy: loadLeadPrivacyConfig().policy,
      record: (userId, leadId) => makeRecordLeadContactSharingUseCase().execute(userId, leadId),
      cancelRequest: (requestId) => new PrismaServiceRequestRepository().updateStatus(requestId, "CANCELLED"),
    },
  );
}
