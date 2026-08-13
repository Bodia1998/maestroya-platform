import type { AuditFinding } from "@/domain/entities/audit-finding";
import type { SubsystemAuditResult } from "@/domain/entities/subsystem-audit-result";
import { ValidationError } from "@/domain/errors/domain-error";

/**
 * Module 58 — Multi-Instance Safety Audit.
 *
 * `MultiInstanceSafetyReport` is the production-readiness sign-off
 * artifact this module exists to produce — the same role `CapacityReport`
 * plays for Module 57, restructured around the audit's own vocabulary
 * (subsystems, findings, an overall score, a production-ready verdict)
 * rather than capacity projections. Like `CapacityReport`, it is a
 * computed snapshot, not a state machine: `RunMultiInstanceSafetyAuditUseCase`
 * builds a fresh one on every `execute()` call rather than mutating a
 * persisted aggregate — this module holds no persistence at all (see
 * `infrastructure/multi-instance-safety/compose.ts`'s own doc comment for
 * why), so there is nothing to mutate in the first place.
 */
export class MultiInstanceSafetyReport {
  private constructor(
    readonly id: string,
    readonly generatedAt: Date,
    readonly subsystems: readonly SubsystemAuditResult[],
    /** 0 (not production ready) to 100 (no concerns identified) — see `AuditScoringService.computeOverallScore`'s own doc comment for the scoring formula. */
    readonly overallScore: number,
    readonly recommendedActions: readonly string[],
  ) {}

  static build(fields: {
    id: string;
    generatedAt: Date;
    subsystems: readonly SubsystemAuditResult[];
    overallScore: number;
    recommendedActions: readonly string[];
  }): MultiInstanceSafetyReport {
    if (!Number.isFinite(fields.overallScore) || fields.overallScore < 0 || fields.overallScore > 100) {
      throw new ValidationError(
        `MultiInstanceSafetyReport.overallScore must be between 0 and 100, received ${String(fields.overallScore)}.`,
      );
    }
    if (fields.subsystems.length === 0) {
      throw new ValidationError("MultiInstanceSafetyReport.subsystems must not be empty — an audit with no checkers audits nothing.");
    }

    return new MultiInstanceSafetyReport(
      fields.id,
      fields.generatedAt,
      fields.subsystems,
      fields.overallScore,
      fields.recommendedActions,
    );
  }

  /**
   * Whether this report reflects a deployment safe to run behind a load
   * balancer with more than one instance — a documented cut line, the
   * same shape `CapacityReport.isProductionReady` uses: a minimum score
   * *and* zero subsystems left in the worst state, so a single
   * undiscovered-but-critical issue can never be masked by a high average
   * score across everything else.
   */
  get isProductionReady(): boolean {
    return this.overallScore >= 70 && !this.subsystems.some((s) => s.status === "CRITICAL");
  }

  get allWarnings(): readonly AuditFinding[] {
    return this.subsystems.flatMap((s) => s.warnings);
  }

  get allCriticalIssues(): readonly AuditFinding[] {
    return this.subsystems.flatMap((s) => s.criticalIssues);
  }

  get totalPassedChecks(): number {
    return this.subsystems.reduce((sum, s) => sum + s.passedChecks.length, 0);
  }
}
