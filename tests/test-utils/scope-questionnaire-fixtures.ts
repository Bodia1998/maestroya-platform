import type { ScopeQuestionnaireDefinition, ScopeQuestionnaireRegistry } from "@/domain/services/lead-scope-questionnaire";

/**
 * Module 163 TEST FIXTURE — arbitrary factors, NOT an approved factor table. Production code never imports this; the active
 * registry (LEAD_SCOPE_QUESTIONNAIRES_V1) stays empty until the owner approves tables.
 */
export const TEST_SCOPE_QUESTIONNAIRE: ScopeQuestionnaireDefinition = {
  questionnaireVersion: "test-scope-v1",
  categorySlug: "fontaneria",
  maxScopeFactor: "3.0",
  maxComplexityFactor: "2.0",
  questions: [
    {
      id: "size",
      required: true,
      kind: "SINGLE_CHOICE",
      options: [
        { value: "small", scopeFactor: "1.0", complexityFactor: "1.0" },
        { value: "large", scopeFactor: "3.0", complexityFactor: "2.0" },
      ],
    },
  ],
};

export const TEST_SCOPE_REGISTRY: ScopeQuestionnaireRegistry = Object.freeze({ fontaneria: TEST_SCOPE_QUESTIONNAIRE });
export const TEST_SCOPE_REGISTRY_V2: ScopeQuestionnaireRegistry = Object.freeze({
  fontaneria: { ...TEST_SCOPE_QUESTIONNAIRE, questionnaireVersion: "test-scope-v2" },
});
