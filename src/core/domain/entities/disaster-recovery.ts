import { InvalidRecoveryTransitionError } from "@/domain/errors/domain-error";

/**
 * Module 54 — Backup & Disaster Recovery.
 *
 * The domain model for disaster-recovery *plans* and their *executions* —
 * the DR analogue of `backup.ts`'s `BackupRecord`. A `DisasterRecoveryPlan`
 * is a named, ordered runbook (what to check/do, in what order, to bring a
 * target back after a declared disaster); a `RecoveryExecution` is one
 * timed, checkpointed run of that runbook — real (an actual incident) or
 * a drill (a scheduled readiness test, see
 * `application/services/recovery/recovery-readiness-service.ts`).
 *
 * Plans themselves are not persisted aggregates — see
 * `application/services/recovery/disaster-recovery-plans.ts`'s own doc
 * comment for why the catalog is code, not a database table. Only
 * *executions* are, because an execution is an audit record of something
 * that actually happened.
 */

export type RecoveryStatus = "PENDING" | "IN_PROGRESS" | "COMPLETED" | "FAILED" | "ABORTED";

export type RecoveryStepStatus = "COMPLETED" | "FAILED" | "SKIPPED";

/** One ordered step of a `DisasterRecoveryPlan`'s runbook. */
export interface RecoveryProcedureStep {
  readonly id: string;
  readonly order: number;
  readonly title: string;
  readonly description: string;
  /** Whether this step can be carried out by `DisasterRecoveryService` itself (e.g. "restore the latest database backup") vs. requiring a human/manual action (e.g. "notify affected customers"). */
  readonly automated: boolean;
}

export interface DisasterRecoveryPlan {
  readonly id: string;
  readonly name: string;
  readonly description: string;
  /** Recovery Time Objective — target maximum time to restore service. */
  readonly rtoMinutes: number;
  /** Recovery Point Objective — target maximum acceptable data loss, measured as backup age. */
  readonly rpoMinutes: number;
  readonly steps: readonly RecoveryProcedureStep[];
}

/** A single recorded checkpoint reached while executing a plan. */
export interface RecoveryCheckpoint {
  readonly stepId: string;
  readonly status: RecoveryStepStatus;
  readonly reachedAt: Date;
  readonly notes: string | null;
}

const ALLOWED_TRANSITIONS: Record<RecoveryStatus, readonly RecoveryStatus[]> = {
  PENDING: ["IN_PROGRESS", "ABORTED"],
  IN_PROGRESS: ["COMPLETED", "FAILED", "ABORTED"],
  COMPLETED: [],
  FAILED: [],
  ABORTED: [],
};

/**
 * One timed run of a `DisasterRecoveryPlan`. Constructed only via
 * `RecoveryExecution.start()`, mirroring `BackupRecord`'s "named factory,
 * no public constructor" convention.
 */
export class RecoveryExecution {
  private constructor(
    readonly id: string,
    readonly planId: string,
    /** Free-text reason this execution was started — e.g. "scheduled drill" or "database-outage-2026-08-09". Never a secret or PII value; see this module's own "never expose sensitive information" requirement. */
    readonly triggeredBy: string,
    /** A drill exercises the plan without a real disaster; readiness reporting only counts drills/real recoveries that reached `COMPLETED`. */
    readonly isDrill: boolean,
    private _status: RecoveryStatus,
    readonly startedAt: Date,
    private _completedAt: Date | null,
    private _checkpoints: RecoveryCheckpoint[],
    private _failureReason: string | null,
  ) {}

  static start(id: string, planId: string, triggeredBy: string, isDrill: boolean, now: Date): RecoveryExecution {
    return new RecoveryExecution(id, planId, triggeredBy, isDrill, "PENDING", now, null, [], null);
  }

  static rehydrate(fields: {
    id: string;
    planId: string;
    triggeredBy: string;
    isDrill: boolean;
    status: RecoveryStatus;
    startedAt: Date;
    completedAt: Date | null;
    checkpoints: RecoveryCheckpoint[];
    failureReason: string | null;
  }): RecoveryExecution {
    return new RecoveryExecution(
      fields.id,
      fields.planId,
      fields.triggeredBy,
      fields.isDrill,
      fields.status,
      fields.startedAt,
      fields.completedAt,
      [...fields.checkpoints],
      fields.failureReason,
    );
  }

  get status(): RecoveryStatus {
    return this._status;
  }

  get completedAt(): Date | null {
    return this._completedAt;
  }

  get checkpoints(): readonly RecoveryCheckpoint[] {
    return this._checkpoints;
  }

  get failureReason(): string | null {
    return this._failureReason;
  }

  private assertTransition(next: RecoveryStatus): void {
    if (!ALLOWED_TRANSITIONS[this._status].includes(next)) {
      throw new InvalidRecoveryTransitionError(
        `Recovery execution ${this.id} cannot transition from ${this._status} to ${next}.`,
      );
    }
  }

  begin(): void {
    this.assertTransition("IN_PROGRESS");
    this._status = "IN_PROGRESS";
  }

  /** Records reaching (or failing) one step. Does not itself change `status` — a failed step does not necessarily fail the whole execution (see `DisasterRecoveryService`, which decides that from the plan's own steps). */
  recordCheckpoint(stepId: string, status: RecoveryStepStatus, now: Date, notes: string | null = null): void {
    if (this._status !== "IN_PROGRESS") {
      throw new InvalidRecoveryTransitionError(
        `Recovery execution ${this.id} cannot record a checkpoint while ${this._status}.`,
      );
    }
    this._checkpoints.push({ stepId, status, reachedAt: now, notes });
  }

  complete(now: Date): void {
    this.assertTransition("COMPLETED");
    this._status = "COMPLETED";
    this._completedAt = now;
  }

  fail(reason: string, now: Date): void {
    this.assertTransition("FAILED");
    this._status = "FAILED";
    this._completedAt = now;
    this._failureReason = reason;
  }

  abort(reason: string, now: Date): void {
    this.assertTransition("ABORTED");
    this._status = "ABORTED";
    this._completedAt = now;
    this._failureReason = reason;
  }

  /** `{ completedSteps, totalSteps }` against a plan's own step count — a pure projection, no plan lookup performed here. */
  progressAgainst(plan: DisasterRecoveryPlan): { completedSteps: number; totalSteps: number; percentage: number } {
    const completedSteps = this._checkpoints.filter((checkpoint) => checkpoint.status === "COMPLETED").length;
    const totalSteps = plan.steps.length;
    return {
      completedSteps,
      totalSteps,
      percentage: totalSteps === 0 ? 0 : Math.round((completedSteps / totalSteps) * 100),
    };
  }
}
