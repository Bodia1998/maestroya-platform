import type { LeadScopeEstimationSource } from "@/application/services/lead-pricing/estimated-value-lead-pricing-context-reader";
import { PrismaLeadScopeAnswersReader } from "@/infrastructure/database/prisma/repositories/prisma-lead-scope-answers-reader";
import { LEAD_SCOPE_QUESTIONNAIRES_V1 } from "@/infrastructure/pricing/lead-scope-questionnaires.v1";

/**
 * Module 163 — stored structured scope + the released questionnaires, shared by every estimator wiring so publication and the
 * purchase price provider can never disagree about how a lead is estimated. The registry is empty until the owner approves a
 * factor table, in which case any stored scope is unusable and the lead stays unpriced (fail closed).
 */
export function makeLeadScopeEstimationSource(): LeadScopeEstimationSource {
  return { reader: new PrismaLeadScopeAnswersReader(), registry: LEAD_SCOPE_QUESTIONNAIRES_V1 };
}
