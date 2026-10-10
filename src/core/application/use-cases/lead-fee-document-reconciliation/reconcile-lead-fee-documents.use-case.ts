import type { LeadFeeDocumentReconciliationReader } from "@/domain/repositories/lead-fee-document-reconciliation-reader";
import {
  LEAD_FEE_RECONCILIATION_NOTICE,
  LEAD_FEE_RECONCILIATION_RULES_VERSION,
  LEAD_FEE_RECONCILIATION_SEVERITIES,
  evaluateLeadFeeDocumentReconciliation,
  type LeadFeeReconciliationFinding,
  type LeadFeeReconciliationFindingCode,
  type LeadFeeReconciliationNotEvaluated,
  type LeadFeeReconciliationSeverity,
} from "@/domain/services/lead-fee-document-reconciliation";

export interface LeadFeeDocumentReconciliationReport {
  rulesVersion: string;
  /** Always present: this is a technical consistency report, never a compliance statement. */
  notice: string;
  /** Wall-clock time of the run. The only non-deterministic field: `findings`, `summary`, `scope` and `notEvaluated` depend on the data alone. */
  generatedAt: Date;
  scope: { ledgerEntries: number; invoices: number; creditNotes: number };
  notEvaluated: LeadFeeReconciliationNotEvaluated;
  summary: {
    total: number;
    bySeverity: Record<LeadFeeReconciliationSeverity, number>;
    byCode: Partial<Record<LeadFeeReconciliationFindingCode, number>>;
  };
  findings: readonly LeadFeeReconciliationFinding[];
}

/**
 * Module 152 — reconciles the M149 lead-fee ledger, the M150 invoices and the M151 credit notes. READ-ONLY.
 *
 * It reads one consistent snapshot through a query-only port, evaluates the pure rules and returns structured findings.
 * It persists nothing, resolves nothing, repairs nothing, issues no document, starts no refund and touches no purchase status
 * or balance. TRUSTED-INTERNAL and deliberately wired to no route, Server Action, webhook, job, queue or scheduler (see
 * docs/MODULE_152_LEAD_FEE_DOCUMENT_RECONCILIATION.md). The result is evidence for a human reviewer; it is not a statement of
 * legal, tax or accounting compliance. Unexpected errors (database, scope limit) propagate — they are never turned into
 * an empty "clean" report.
 */
export class ReconcileLeadFeeDocumentsUseCase {
  constructor(
    private readonly reader: LeadFeeDocumentReconciliationReader,
    private readonly now: () => Date = () => new Date(),
  ) {}

  async execute(): Promise<LeadFeeDocumentReconciliationReport> {
    const snapshot = await this.reader.readSnapshot();
    const { findings, notEvaluated } = evaluateLeadFeeDocumentReconciliation(snapshot);

    const bySeverity = Object.fromEntries(LEAD_FEE_RECONCILIATION_SEVERITIES.map((s) => [s, 0])) as Record<LeadFeeReconciliationSeverity, number>;
    const byCode: Partial<Record<LeadFeeReconciliationFindingCode, number>> = {};
    for (const finding of findings) {
      bySeverity[finding.severity] += 1;
      byCode[finding.code] = (byCode[finding.code] ?? 0) + 1;
    }

    return {
      rulesVersion: LEAD_FEE_RECONCILIATION_RULES_VERSION,
      notice: LEAD_FEE_RECONCILIATION_NOTICE,
      generatedAt: this.now(),
      scope: { ledgerEntries: snapshot.ledgerEntries.length, invoices: snapshot.invoices.length, creditNotes: snapshot.creditNotes.length },
      notEvaluated,
      summary: { total: findings.length, bySeverity, byCode },
      findings,
    };
  }
}
