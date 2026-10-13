import type { ScopeQuestionnaireRegistry } from "@/domain/services/lead-scope-questionnaire";

/**
 * Module 163 — ACTIVE scope questionnaires. DATA ONLY, keyed by ServiceCategory.slug.
 *
 * DELIBERATELY EMPTY. A questionnaire carries the category-by-category scope /
 * complexity factor tables, which the roadmap lists as a business decision, and
 * the decisions they depend on (D3 rates/caps, D4 confidence policy, D21 pilot
 * categories) are not recorded as approved. Until the owner approves a table,
 * no category has structured scope: every lookup is QUESTIONNAIRE_NOT_CONFIGURED
 * and estimation behaves exactly as before Module 163 (fail closed).
 *
 * To activate a category: add a reviewed, versioned definition here (never edit
 * a released one in place — add a new `questionnaireVersion`), with tests and
 * the owner's approval reference in the PR. `isValidScopeQuestionnaireDefinition`
 * rejects any definition whose worst-case factor product exceeds its declared
 * maxima. Nothing else in the codebase imports this registry yet: wiring it
 * into request submission needs the additive persistence described in
 * docs/MODULE_163_STRUCTURED_SCOPE_QUESTIONNAIRE_ESTIMATION_V2.md.
 */
export const LEAD_SCOPE_QUESTIONNAIRES_V1: ScopeQuestionnaireRegistry = Object.freeze({});
