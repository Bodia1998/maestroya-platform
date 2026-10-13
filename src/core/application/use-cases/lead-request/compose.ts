import { leadRequestCategoryPolicyFrom } from "@/domain/services/lead-request-category-support";
import { PrismaLeadRequestCategoryRepository } from "@/infrastructure/database/prisma/repositories/prisma-lead-request-category-repository";
import { makeCreateLeadV1ServiceRequestUseCase } from "@/application/use-cases/lead/compose";
import { makePublishLeadUseCase, resolveLeadPublicationConfiguration } from "@/application/use-cases/lead-publication/compose";
import { ListLeadRequestCategoriesUseCase } from "@/application/use-cases/lead-request/list-lead-request-categories.use-case";
import { SubmitLeadRequestUseCase } from "@/application/use-cases/lead-request/submit-lead-request.use-case";
import { makeRecordLeadContactSharingUseCase } from "@/application/use-cases/lead-privacy/compose";
import { guardLeadV1Entry } from "@/application/use-cases/lead-rollout/compose";
import { LEAD_SCOPE_QUESTIONNAIRES_V1 } from "@/infrastructure/pricing/lead-scope-questionnaires.v1";
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
  return new ListLeadRequestCategoriesUseCase(categories, leadRequestCategoryPolicyFrom(configuration), LEAD_SCOPE_QUESTIONNAIRES_V1);
}

export function makeSubmitLeadRequestUseCase(configuration: Configuration = resolveLeadPublicationConfiguration()) {
  // Module 159: outermost ENTRY guard (the nested create / publish factories are guarded too). A refused submission does nothing:
  // no category read, no consent evidence, no service request, no lead.
  return guardLeadV1Entry(
    new SubmitLeadRequestUseCase(
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
      // Module 163: released scope questionnaires (empty until the owner approves a factor table => scope answers are refused).
      LEAD_SCOPE_QUESTIONNAIRES_V1,
    ),
  );
}
