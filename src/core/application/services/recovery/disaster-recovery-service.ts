import type { DisasterRecoveryPlan } from "@/domain/entities/disaster-recovery";
import { RecoveryExecution } from "@/domain/entities/disaster-recovery";
import type { RecoveryExecutionRepository } from "@/domain/repositories/recovery-execution-repository";

/** One automated step's implementation, keyed by `RecoveryProcedureStep.id`. Throwing means the step failed. */
export type RecoveryStepHandlers = Readonly<Record<string, () => Promise<void>>>;

export interface DisasterRecoveryServiceDependencies {
  repository: RecoveryExecutionRepository;
  generateId: () => string;
  now: () => Date;
}

/**
 * Module 54 — Backup & Disaster Recovery.
 *
 * Executes a `DisasterRecoveryPlan` step by step, recording a
 * `RecoveryCheckpoint` for every one, and persists the resulting
 * `RecoveryExecution` — the DR analogue of `CreateBackupUseCase`'s
 * orchestration role, kept as its own service (rather than folded
 * directly into `RunDisasterRecoveryUseCase`) because the step-execution
 * algorithm below is substantial enough to deserve its own unit tests
 * against a fake `RecoveryExecutionRepository`, independent of how a
 * caller obtains the plan or handlers.
 *
 * ## Execution semantics
 * Steps run strictly in `order`. An **automated** step with no matching
 * handler, or whose handler throws, fails the checkpoint and — because an
 * unrecoverable automated step means the runbook cannot safely continue —
 * fails the whole execution immediately, without attempting later steps.
 * A **non-automated** step is recorded `SKIPPED` (it requires a human
 * action this service cannot perform) and execution continues; a plan
 * with only non-automated steps remaining after the automated ones still
 * reaches `COMPLETED` — "the automation's part is done, a human must
 * finish the rest" is a successful automated run, not a failed one.
 *
 * Fails safely by construction: every path either completes the
 * execution or fails it explicitly (`assertTransition` in
 * `RecoveryExecution` would otherwise throw on a double-transition, which
 * this method's own control flow never attempts), and nothing here can
 * leave a `RecoveryExecution` stuck `IN_PROGRESS` in storage without an
 * exception already having propagated to the caller.
 */
export class DisasterRecoveryService {
  constructor(private readonly deps: DisasterRecoveryServiceDependencies) {}

  async execute(
    plan: DisasterRecoveryPlan,
    handlers: RecoveryStepHandlers,
    triggeredBy: string,
    isDrill: boolean,
  ): Promise<RecoveryExecution> {
    const execution = RecoveryExecution.start(this.deps.generateId(), plan.id, triggeredBy, isDrill, this.deps.now());
    execution.begin();
    await this.deps.repository.save(execution);

    const orderedSteps = [...plan.steps].sort((a, b) => a.order - b.order);

    for (const step of orderedSteps) {
      if (!step.automated) {
        execution.recordCheckpoint(step.id, "SKIPPED", this.deps.now(), "Requires manual action.");
        continue;
      }

      const handler = handlers[step.id];
      try {
        if (!handler) throw new Error(`No automated handler registered for step "${step.id}".`);
        await handler();
        execution.recordCheckpoint(step.id, "COMPLETED", this.deps.now());
      } catch (error) {
        const reason = error instanceof Error ? error.message : String(error);
        execution.recordCheckpoint(step.id, "FAILED", this.deps.now(), reason);
        execution.fail(`Step "${step.id}" failed: ${reason}`, this.deps.now());
        await this.deps.repository.save(execution);
        return execution;
      }
    }

    execution.complete(this.deps.now());
    await this.deps.repository.save(execution);
    return execution;
  }
}
