import { ReconcileLeadFeeDocumentsUseCase } from "@/application/use-cases/lead-fee-document-reconciliation/reconcile-lead-fee-documents.use-case";
import { PrismaLeadFeeDocumentReconciliationReader } from "@/infrastructure/database/prisma/repositories/prisma-lead-fee-document-reconciliation-reader";

/**
 * Module 152 — composition root of the lead-fee document reconciliation (plain factory, no DI container).
 *
 * TRUSTED-INTERNAL and READ-ONLY. Nothing in the application calls this today: no route, Server Action, webhook, cron job,
 * queue or scheduler (pinned by a static test). Running it changes no record — it neither issues, repairs nor resolves anything.
 * See docs/MODULE_152_LEAD_FEE_DOCUMENT_RECONCILIATION.md.
 */
export function makeReconcileLeadFeeDocumentsUseCase() {
  return new ReconcileLeadFeeDocumentsUseCase(new PrismaLeadFeeDocumentReconciliationReader());
}
