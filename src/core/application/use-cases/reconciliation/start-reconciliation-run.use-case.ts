import { createHash, randomUUID } from "node:crypto";

import type { ReconciliationDataSource } from "@/application/ports/reconciliation-data-source";
import type { ProviderFinancialReconciliationPort } from "@/application/ports/provider-financial-reconciliation";
import type { StartReconciliationRunInput } from "@/application/dto/reconciliation.dto";
import type { EventBus } from "@/application/ports/event-bus";
import { type FailureReporter, NullFailureReporter } from "@/application/ports/failure-reporter";
import { publishDomainEvent } from "@/application/services/events/publish-domain-event";
import { ReconciliationRunStarted } from "@/domain/events/reconciliation-run-started";
import { ReconciliationRunCompleted } from "@/domain/events/reconciliation-run-completed";
import { ReconciliationRunFailed } from "@/domain/events/reconciliation-run-failed";
import { DiscrepancyDetected } from "@/domain/events/discrepancy-detected";
import type {
  ReconciliationRunRepository,
  ReconciliationDiscrepancyRepository,
  ReconciliationRunRecord,
  ReconciliationScopeValue,
} from "@/domain/repositories/reconciliation-repository";
import { checkPaymentConsistency } from "@/domain/services/reconciliation/payment-checks";
import { checkCommissionConsistency } from "@/domain/services/reconciliation/commission-checks";
import { checkTaxConsistency } from "@/domain/services/reconciliation/tax-checks";
import { checkInvoiceConsistency } from "@/domain/services/reconciliation/invoice-checks";
import { checkPayoutConsistency } from "@/domain/services/reconciliation/payout-checks";
import { checkRefundConsistency } from "@/domain/services/reconciliation/refund-checks";
import { checkCreditNoteConsistency } from "@/domain/services/reconciliation/credit-note-checks";
import { checkProviderConsistency, type LocalProviderReference } from "@/domain/services/reconciliation/provider-checks";
import { computeDiscrepancyFingerprint } from "@/domain/services/reconciliation/fingerprint";
import { determineDiscrepancySeverity } from "@/domain/services/reconciliation/severity";
import { withDifference, type DiscrepancyCandidate } from "@/domain/services/reconciliation/types";
import type { JobFinancialContext } from "@/domain/services/reconciliation/context";
import {
  recordDiscrepancyDetected,
  recordReconciliationCompleted,
  recordReconciliationFailed,
  recordReconciliationStarted,
} from "@/infrastructure/observability/reconciliation-observability";

export interface ReconciliationRunSummary {
  run: ReconciliationRunRecord;
  discrepanciesCreated: number;
  discrepanciesReconfirmed: number;
}

/**
 * Module 80 — Financial Reconciliation & Observability.
 *
 * The orchestrator: creates a RUNNING `ReconciliationRun`, scans the Jobs
 * `ReconciliationDataSource` selects, runs every check enabled by `scope`
 * against each Job's `JobFinancialContext`, persists any discrepancy via
 * the fingerprint-deduplicating `createOrTouch`, and finalizes the run as
 * COMPLETED (or FAILED, if the engine itself throws — never for finding
 * discrepancies, which is this module's entire purpose, not a failure of
 * it).
 *
 * ## Read-only guarantee
 * This class never calls a write method on any Module 22/64/73-79
 * repository — `dataSource` is a read-only port (see its own doc
 * comment), and every check module it calls is a pure function. The only
 * writes this class performs are to `ReconciliationRunRepository`/
 * `ReconciliationDiscrepancyRepository` — Module 80's own tables.
 *
 * ## Idempotency / concurrency
 * Every call to `execute()` performs a fresh scan and always creates a
 * new `ReconciliationRun` row — repeated runs are expected and safe.
 * Idempotency instead lives one level down, in
 * `ReconciliationDiscrepancyRepository.createOrTouch`: a still-open
 * discrepancy from a previous run is never duplicated, only re-confirmed
 * (`lastSeenRunId` updated). This makes the engine itself safe to invoke
 * concurrently (e.g. a scheduled run and a manual admin-triggered run
 * overlapping) without any additional locking — see that repository's
 * own doc comment for the database-level backstop.
 */
export class StartReconciliationRunUseCase {
  constructor(
    private readonly dataSource: ReconciliationDataSource,
    private readonly runs: ReconciliationRunRepository,
    private readonly discrepancies: ReconciliationDiscrepancyRepository,
    private readonly provider: ProviderFinancialReconciliationPort,
    private readonly eventBus: EventBus,
    private readonly failureReporter: FailureReporter = new NullFailureReporter(),
  ) {}

  async execute(input: StartReconciliationRunInput, triggeredByUserId: string | null): Promise<ReconciliationRunSummary> {
    const runId = randomUUID();
    const startedAt = new Date();
    const parametersHash = createHash("sha256")
      .update(JSON.stringify({ scope: input.scope, since: input.since?.toISOString() ?? null, limit: input.limit }))
      .digest("hex")
      .slice(0, 16);

    let run = await this.runs.start({
      id: runId,
      scope: input.scope,
      parametersHash,
      triggeredByUserId,
      startedAt,
    });

    recordReconciliationStarted({ runId, scope: input.scope, triggeredByUserId });
    await publishDomainEvent(this.eventBus, new ReconciliationRunStarted(runId, input.scope, triggeredByUserId), this.failureReporter);

    let recordsInspected = 0;
    let created = 0;
    let reconfirmed = 0;

    try {
      const jobIds = await this.dataSource.listJobIdsToInspect({ since: input.since, limit: input.limit });

      for (const jobId of jobIds) {
        const context = await this.dataSource.getJobFinancialContext(jobId);
        if (!context) continue;
        recordsInspected += 1;

        const candidates = await this.evaluateJob(context, input.scope);
        for (const candidate of candidates) {
          const outcome = await this.persistCandidate(candidate, runId);
          if (outcome.created) created += 1;
          else reconfirmed += 1;
        }
      }

      const completedAt = new Date();
      const durationMs = completedAt.getTime() - startedAt.getTime();
      const discrepancyCount = created + reconfirmed;

      run = await this.runs.complete({
        id: runId,
        completedAt,
        durationMs,
        recordsInspected,
        discrepancyCount,
      });

      recordReconciliationCompleted({ runId, scope: input.scope, recordsInspected, discrepancyCount, durationMs });
      await publishDomainEvent(
        this.eventBus,
        new ReconciliationRunCompleted(runId, input.scope, recordsInspected, discrepancyCount, durationMs),
        this.failureReporter,
      );

      return { run, discrepanciesCreated: created, discrepanciesReconfirmed: reconfirmed };
    } catch (error) {
      const completedAt = new Date();
      const durationMs = completedAt.getTime() - startedAt.getTime();
      const errorMessage = error instanceof Error ? error.message : String(error);

      run = await this.runs.fail({
        id: runId,
        completedAt,
        durationMs,
        recordsInspected,
        errorMessage,
      });

      recordReconciliationFailed({ runId, scope: input.scope, errorMessage, recordsInspected });
      await publishDomainEvent(this.eventBus, new ReconciliationRunFailed(runId, input.scope, errorMessage, recordsInspected), this.failureReporter);

      return { run, discrepanciesCreated: created, discrepanciesReconfirmed: reconfirmed };
    }
  }

  private async evaluateJob(context: JobFinancialContext, scope: ReconciliationScopeValue): Promise<DiscrepancyCandidate[]> {
    const findings: DiscrepancyCandidate[] = [];
    const runsAll = scope === "FULL";

    if (runsAll || scope === "PAYMENT") findings.push(...checkPaymentConsistency(context));
    if (runsAll || scope === "COMMISSION") findings.push(...checkCommissionConsistency(context));
    if (runsAll || scope === "TAX") findings.push(...checkTaxConsistency(context));
    if (runsAll || scope === "INVOICE") findings.push(...checkInvoiceConsistency(context));
    if (runsAll || scope === "PAYOUT") findings.push(...checkPayoutConsistency(context));
    if (runsAll || scope === "REFUND") findings.push(...checkRefundConsistency(context));
    if (runsAll || scope === "CREDIT_NOTE") findings.push(...checkCreditNoteConsistency(context));

    if (runsAll || scope === "PROVIDER") {
      findings.push(...(await this.evaluateProvider(context)));
    }

    return findings;
  }

  private async evaluateProvider(context: JobFinancialContext): Promise<DiscrepancyCandidate[]> {
    const findings: DiscrepancyCandidate[] = [];
    const references: LocalProviderReference[] = [];

    for (const payment of context.payments) {
      if (payment.stripePaymentIntentId) {
        references.push({
          entityType: "PAYMENT",
          entityId: payment.id,
          jobId: context.jobId,
          externalReference: payment.stripePaymentIntentId,
          localAmount: payment.amount,
          localCurrency: payment.currency,
          localSettled: payment.status === "CAPTURED" || payment.status === "PARTIALLY_REFUNDED" || payment.status === "REFUNDED",
        });
      }
    }
    if (context.payout?.stripeTransferId) {
      references.push({
        entityType: "PAYOUT",
        entityId: context.payout.id,
        jobId: context.jobId,
        externalReference: context.payout.stripeTransferId,
        localAmount: context.payout.amount,
        localCurrency: context.payout.currency,
        localSettled: context.payout.status === "PAID",
      });
    }
    for (const refund of context.refunds) {
      if (refund.stripeRefundId) {
        references.push({
          entityType: "REFUND",
          entityId: refund.id,
          jobId: context.jobId,
          externalReference: refund.stripeRefundId,
          localAmount: refund.amount,
          localCurrency: context.payments.find((p) => p.id === refund.paymentId)?.currency ?? "EUR",
          localSettled: refund.status === "PROCESSED",
        });
      }
    }

    for (const ref of references) {
      const providerState =
        ref.entityType === "PAYMENT"
          ? await this.provider.retrievePaymentState(ref.externalReference)
          : ref.entityType === "PAYOUT"
            ? await this.provider.retrieveTransferState(ref.externalReference)
            : await this.provider.retrieveRefundState(ref.externalReference);
      findings.push(...checkProviderConsistency(ref, providerState));
    }

    return findings;
  }

  private async persistCandidate(candidate: DiscrepancyCandidate, runId: string): Promise<{ created: boolean }> {
    const fingerprint = computeDiscrepancyFingerprint(candidate);
    const severity = determineDiscrepancySeverity(candidate);
    // Reuses the same single differenceValue computation every other
    // reconciliation call site is expected to use (Module 84 hardening —
    // this used to reimplement the identical rounding formula inline).
    const { differenceValue } = withDifference(candidate);

    const { record, created } = await this.discrepancies.createOrTouch({
      id: randomUUID(),
      detectedByRunId: runId,
      entityType: candidate.entityType,
      entityId: candidate.entityId,
      jobId: candidate.jobId,
      paymentId: candidate.paymentId,
      invoiceId: candidate.invoiceId,
      payoutId: candidate.payoutId,
      refundId: candidate.refundId,
      creditNoteId: candidate.creditNoteId,
      category: candidate.category,
      severity,
      expectedValue: candidate.expectedValue,
      actualValue: candidate.actualValue,
      differenceValue,
      currency: candidate.currency,
      explanation: candidate.explanation,
      fingerprint,
      detectedAt: new Date(),
    });

    if (created) {
      recordDiscrepancyDetected({
        discrepancyId: record.id,
        runId,
        category: record.category,
        severity: record.severity,
        entityType: record.entityType,
        entityId: record.entityId,
        jobId: record.jobId,
        expectedValue: record.expectedValue,
        actualValue: record.actualValue,
        differenceValue: record.differenceValue,
      });
      await publishDomainEvent(
        this.eventBus,
        new DiscrepancyDetected(record.id, runId, record.category, record.severity, record.entityType, record.entityId, record.jobId),
        this.failureReporter,
      );
    }

    return { created };
  }
}
