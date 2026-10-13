import { prisma } from "@/infrastructure/database/prisma/client";
import type { LeadScopeAnswersReader, StoredLeadScope } from "@/application/ports/lead-scope-answers-reader";

/**
 * Module 163 — Prisma adapter for the stored structured scope of a Lead's
 * ServiceRequest. Explicit select of the two scope columns ONLY; never add
 * customer, address, contact, free-text or budget columns. Read-only.
 */
export class PrismaLeadScopeAnswersReader implements LeadScopeAnswersReader {
  async findByLeadId(leadId: string): Promise<StoredLeadScope | null> {
    const row = await prisma.lead.findUnique({
      where: { id: leadId },
      select: { serviceRequest: { select: { scopeAnswers: true, scopeQuestionnaireVersion: true } } },
    });
    const request = row?.serviceRequest;
    if (!request) return null;
    const { scopeAnswers, scopeQuestionnaireVersion } = request;
    if (scopeAnswers === null && scopeQuestionnaireVersion === null) return null;
    // The migration's CHECK makes a half-present pair impossible; if one ever appears it is corruption, never "no scope".
    if (scopeAnswers === null || scopeQuestionnaireVersion === null) throw new Error(`Lead "${leadId}" has an incomplete stored scope.`);
    return { questionnaireVersion: scopeQuestionnaireVersion, answers: scopeAnswers };
  }
}
