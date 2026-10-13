import type { LeadRequestCategoryRepository } from "@/domain/repositories/lead-request-category-repository";
import {
  isLeadRequestCategorySupported,
  type LeadRequestCategoryPolicy,
} from "@/domain/services/lead-request-category-support";
import { findScopeQuestionnaire, toScopeQuestionnaireView, type ScopeQuestionnaireRegistry } from "@/domain/services/lead-scope-questionnaire";
import type { LeadRequestCategoryOption } from "@/application/dto/lead-request.dto";

/**
 * Module 142 — the categories a customer may choose for a LEAD_V1 request:
 * ACTIVE categories that the Module 132 pilot configuration supports. The
 * policy is derived from that configuration by the composition root; this is
 * a presentation-safe projection (id, slug, name) — no pricing data.
 */
export class ListLeadRequestCategoriesUseCase {
  constructor(
    private readonly categories: LeadRequestCategoryRepository,
    private readonly policy: LeadRequestCategoryPolicy,
    /** Module 163: released questionnaires. Absent/empty = no category offers a scope step. */
    private readonly scopeQuestionnaires: ScopeQuestionnaireRegistry = {},
  ) {}

  async execute(): Promise<LeadRequestCategoryOption[]> {
    const all = await this.categories.listActive();
    return all
      .filter((category) => isLeadRequestCategorySupported(category, this.policy))
      .map(({ id, slug, name, parentSlug }) => {
        const definition = findScopeQuestionnaire(this.scopeQuestionnaires, slug, parentSlug);
        const scope = definition ? toScopeQuestionnaireView(definition) : null;
        return scope ? { id, slug, name, scope } : { id, slug, name };
      });
  }
}
