import type { LeadRequestScopeIssueCode } from "@/application/use-cases/lead-request/submit-lead-request.use-case";

/** Exhaustive by type: adding an issue code without extending this record fails the typecheck, so its translation cannot be forgotten. */
const ISSUE_CODE_RECORD = {
  INVALID_DEFINITION: 1,
  ANSWERS_MALFORMED: 1,
  UNKNOWN_QUESTION: 1,
  MISSING_REQUIRED: 1,
  INVALID_TYPE: 1,
  VALUE_NOT_ALLOWED: 1,
  OUT_OF_RANGE: 1,
  CONTRADICTORY_ANSWERS: 1,
  QUESTIONNAIRE_NOT_AVAILABLE: 1,
} satisfies Record<LeadRequestScopeIssueCode, 1>;

export const SCOPE_ANSWER_ISSUE_CODES_FOR_TEST = Object.keys(ISSUE_CODE_RECORD);
