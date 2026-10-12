import { randomUUID } from "node:crypto";

import { ValidationError } from "@/domain/errors/domain-error";
import type { AdminAuditLogRepository } from "@/domain/repositories/admin-audit-log-repository";
import type {
  LeadPrivacyRetentionRepository,
  LeadRequestAnonymizationResult,
} from "@/domain/repositories/lead-privacy-repository";
import {
  MAX_LEAD_PRIVACY_BATCH_SIZE,
  requestContentRetentionCutoff,
  type LeadPrivacyPolicy,
} from "@/domain/services/lead-privacy";
import type { DistributedLock } from "@/application/ports/distributed-lock";
import { type FailureReporter, NullFailureReporter } from "@/application/ports/failure-reporter";
import { logger } from "@/infrastructure/observability/logger";

export type LeadPrivacyPhase = "ERASED_CUSTOMER_REQUESTS" | "TERMINAL_REQUEST_MINIMIZATION" | "ROLLOUT_REPORT" | "AUDIT";

export interface LeadPrivacyRetentionRunResult {
  outcome: "completed" | "completed_with_failures" | "skipped_locked";
  dryRun: boolean;
  erasedCustomerRequests: LeadRequestAnonymizationResult;
  terminalRequestMinimization: LeadRequestAnonymizationResult & {
    /** `POLICY_NOT_CONFIGURED` = no approved retention period (D20): nothing was examined. */
    status: "RAN" | "POLICY_NOT_CONFIGURED";
  };
  /** Counts only. `null` when the report itself failed. */
  openLeadsWithoutContactSharingRecord: number | null;
  /** Value-free view of which decisions are still open; never the configured values. */
  policy: { contactSharingBasisConfigured: boolean; noticeVersionConfigured: boolean; retentionPeriodConfigured: boolean };
  failedPhases: LeadPrivacyPhase[];
}

const LOCK_KEY = "lead-privacy-retention";
const LOCK_TTL_MS = 5 * 60 * 1000;
/** Upper bound of batches per phase per invocation (a run is always bounded, never "until empty"). */
const MAX_BATCHES_PER_PHASE = 10;

const ZERO: LeadRequestAnonymizationResult = { eligible: 0, anonymized: 0, leadsCancelled: 0 };

function add(a: LeadRequestAnonymizationResult, b: LeadRequestAnonymizationResult): LeadRequestAnonymizationResult {
  return { eligible: a.eligible + b.eligible, anonymized: a.anonymized + b.anonymized, leadsCancelled: a.leadsCancelled + b.leadsCancelled };
}

/**
 * Module 158 — the scheduled / on-demand LEAD_V1 privacy sweep. Two independent, bounded, idempotent phases:
 *
 *  1. ERASED CUSTOMER REQUESTS (no period needed — erasure is the data subject's request): LEAD_V1 request free text of customers
 *     whose account was erased is overwritten and the request/lead cancelled. This is also the REPAIR path of
 *     `ExecuteAccountErasureUseCase`: if that use case crashed after anonymizing the account but before the lead step, the next
 *     sweep finishes the job.
 *  2. TERMINAL REQUEST MINIMIZATION: only when an approved retention period is configured (D20, `LEAD_REQUEST_CONTENT_RETENTION_DAYS`);
 *     with none, it examines nothing and says so (`POLICY_NOT_CONFIGURED`). No legal period is invented here.
 *
 * `dryRun` reports what WOULD change and writes nothing (not even an audit entry). A real run takes a distributed lock (a
 * concurrent run reports `skipped_locked`), processes at most MAX_BATCHES_PER_PHASE batches of `batchSize` per phase, and records ONE
 * audit entry (`GDPR_DELETION_EXECUTED`, system actor, counts only) when it changed something. A repeat of a finished run finds
 * nothing and records nothing. A failing phase never stops the other one; failures are reported through the FailureReporter with
 * value-free context and returned in `failedPhases` so the scheduler surfaces them. Logs carry counts only.
 */
export class RunLeadPrivacyRetentionUseCase {
  constructor(
    private readonly repo: LeadPrivacyRetentionRepository,
    private readonly policy: LeadPrivacyPolicy,
    private readonly auditLog: AdminAuditLogRepository,
    private readonly lock: DistributedLock | null = null,
    private readonly failureReporter: FailureReporter = new NullFailureReporter(),
    private readonly now: () => Date = () => new Date(),
  ) {}

  async execute(options: { batchSize: number; dryRun: boolean }): Promise<LeadPrivacyRetentionRunResult> {
    const { batchSize, dryRun } = options;
    if (!Number.isInteger(batchSize) || batchSize < 1 || batchSize > MAX_LEAD_PRIVACY_BATCH_SIZE) {
      throw new ValidationError("Batch size is out of range.");
    }
    if (dryRun || !this.lock) return this.run(batchSize, dryRun);

    const result = await this.lock.withLock(LOCK_KEY, LOCK_TTL_MS, () => this.run(batchSize, false));
    if (result === null) {
      return {
        outcome: "skipped_locked",
        dryRun,
        erasedCustomerRequests: ZERO,
        terminalRequestMinimization: { ...ZERO, status: this.minimizationStatus() },
        openLeadsWithoutContactSharingRecord: null,
        policy: this.policyView(),
        failedPhases: [],
      };
    }
    return result;
  }

  private minimizationStatus(): "RAN" | "POLICY_NOT_CONFIGURED" {
    return requestContentRetentionCutoff(this.now(), this.policy.requestContentRetentionDays) === null ? "POLICY_NOT_CONFIGURED" : "RAN";
  }

  private policyView() {
    return {
      contactSharingBasisConfigured: this.policy.contactSharingBasis !== null,
      noticeVersionConfigured: this.policy.noticeVersion !== null,
      retentionPeriodConfigured: this.policy.requestContentRetentionDays !== null,
    };
  }

  private async batches(
    phase: LeadPrivacyPhase,
    dryRun: boolean,
    batchSize: number,
    step: () => Promise<LeadRequestAnonymizationResult>,
    failedPhases: LeadPrivacyPhase[],
  ): Promise<LeadRequestAnonymizationResult> {
    let total = ZERO;
    try {
      // A dry run changes nothing, so a second batch would see the same rows: one batch only.
      const max = dryRun ? 1 : MAX_BATCHES_PER_PHASE;
      for (let i = 0; i < max; i += 1) {
        const r = await step();
        total = add(total, r);
        if (r.eligible < batchSize) break;
      }
    } catch (error) {
      failedPhases.push(phase);
      this.failureReporter.report(error, { operation: "lead_privacy_retention", phase });
      logger.error("lead_privacy_retention.phase_failed", { phase });
    }
    return total;
  }

  private async run(batchSize: number, dryRun: boolean): Promise<LeadPrivacyRetentionRunResult> {
    const failedPhases: LeadPrivacyPhase[] = [];
    const started = this.now();

    const erased = await this.batches(
      "ERASED_CUSTOMER_REQUESTS",
      dryRun,
      batchSize,
      () => this.repo.anonymizeRequestsOfErasedCustomers({ limit: batchSize, dryRun }),
      failedPhases,
    );

    const cutoff = requestContentRetentionCutoff(started, this.policy.requestContentRetentionDays);
    const minimized =
      cutoff === null
        ? ZERO
        : await this.batches(
            "TERMINAL_REQUEST_MINIMIZATION",
            dryRun,
            batchSize,
            () => this.repo.minimizeTerminalLeadRequestContent({ limit: batchSize, dryRun, cutoff }),
            failedPhases,
          );

    let openWithout: number | null = null;
    try {
      openWithout = await this.repo.countOpenLeadsWithoutContactSharingRecord();
    } catch (error) {
      failedPhases.push("ROLLOUT_REPORT");
      this.failureReporter.report(error, { operation: "lead_privacy_retention", phase: "ROLLOUT_REPORT" });
    }

    if (!dryRun && (erased.anonymized > 0 || minimized.anonymized > 0)) {
      try {
        await this.auditLog.record({
          adminUserId: null,
          action: "GDPR_DELETION_EXECUTED",
          targetType: "LeadPrivacyRetentionRun",
          targetId: randomUUID(),
          metadata: {
            mode: "AUTOMATED_LEAD_PRIVACY_RETENTION",
            erasedCustomerRequestsAnonymized: erased.anonymized,
            leadsCancelled: erased.leadsCancelled,
            terminalRequestsMinimized: minimized.anonymized,
            retentionDays: this.policy.requestContentRetentionDays,
          },
        });
      } catch (error) {
        failedPhases.push("AUDIT");
        this.failureReporter.report(error, { operation: "lead_privacy_retention", phase: "AUDIT" });
      }
    }

    logger.info("lead_privacy_retention.completed", {
      dryRun,
      erasedCustomerRequests: erased.anonymized,
      erasedCustomerRequestsEligible: erased.eligible,
      leadsCancelled: erased.leadsCancelled,
      terminalRequestsMinimized: minimized.anonymized,
      failedPhases: failedPhases.length,
    });

    return {
      outcome: failedPhases.length > 0 ? "completed_with_failures" : "completed",
      dryRun,
      erasedCustomerRequests: erased,
      terminalRequestMinimization: { ...minimized, status: cutoff === null ? "POLICY_NOT_CONFIGURED" : "RAN" },
      openLeadsWithoutContactSharingRecord: openWithout,
      policy: this.policyView(),
      failedPhases,
    };
  }
}
