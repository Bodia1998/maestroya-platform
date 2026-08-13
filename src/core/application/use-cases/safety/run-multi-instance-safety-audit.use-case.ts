import type { AuditScoringService } from "@/application/services/safety/audit-scoring-service";
import type { SafetyChecker, SubsystemCheckOutcome } from "@/application/ports/safety-checker";
import { AuditFinding } from "@/domain/entities/audit-finding";
import { MultiInstanceSafetyReport } from "@/domain/entities/multi-instance-safety-report";
import { SubsystemAuditResult } from "@/domain/entities/subsystem-audit-result";

export interface RunMultiInstanceSafetyAuditDeps {
  readonly checkers: readonly SafetyChecker[];
  readonly scoring: AuditScoringService;
  readonly generateId: () => string;
  readonly now: () => Date;
}

/**
 * Module 58 — Multi-Instance Safety Audit.
 *
 * The single entry point: runs every registered `SafetyChecker`, folds
 * their output into `SubsystemAuditResult`s, scores the result via
 * `AuditScoringService`, and returns the assembled `MultiInstanceSafetyReport`
 * — the same "main entry point" role `GenerateCapacityReportUseCase` plays
 * for Module 57.
 *
 * ## A checker that throws does not fail the audit
 * Every checker is run through `Promise.allSettled`, not a plain
 * `Promise.all` — one checker's own bug (e.g. an unexpected file-system
 * error while reading a source file) must never prevent every other
 * subsystem from being reported on. A rejected checker is converted into
 * a single synthetic `CRITICAL` finding for its own subsystem ("this
 * checker could not complete its inspection"), which is the conservative,
 * safe default: a subsystem that could not be verified is treated as
 * unverified, not implicitly safe.
 *
 * Checkers run concurrently (`allSettled` starts every `check()` promise
 * before awaiting any of them) — they are pure, read-only static-analysis
 * over the repository's own source tree, so there is no shared mutable
 * state between them to race on.
 */
export class RunMultiInstanceSafetyAuditUseCase {
  constructor(private readonly deps: RunMultiInstanceSafetyAuditDeps) {}

  async execute(): Promise<MultiInstanceSafetyReport> {
    const { checkers, scoring, generateId, now } = this.deps;

    const settled = await Promise.allSettled(checkers.map((checker) => checker.check()));
    const checkerOutcomes: ReadonlyArray<readonly [SafetyChecker, PromiseSettledResult<SubsystemCheckOutcome>]> = checkers.map(
      (checker, index) => [checker, settled[index]!] as const,
    );

    const subsystems: SubsystemAuditResult[] = checkerOutcomes.map(([checker, outcome]) => {
      if (outcome.status === "rejected") {
        const failure = new AuditFinding(
          generateId(),
          checker.subsystem,
          "CRITICAL",
          `The "${checker.subsystem}" checker failed to complete its inspection.`,
          "This subsystem's multi-instance safety could not be verified by this audit run.",
          `The checker threw an unexpected error: ${String(outcome.reason)}`,
          "An unverified subsystem must be treated as unsafe until the checker itself is fixed and re-run.",
          `Investigate and fix the "${checker.subsystem}" checker (see infrastructure/multi-instance-safety/checkers), then re-run npm run multi-instance-audit.`,
          "HIGH",
          [],
        );
        return SubsystemAuditResult.build(checker.subsystem, [], [failure]);
      }

      const findings = outcome.value.findings.map(
        (input) =>
          new AuditFinding(
            generateId(),
            checker.subsystem,
            input.severity,
            input.problem,
            input.risk,
            input.whyItHappens,
            input.impact,
            input.recommendedFix,
            input.priority,
            input.evidence ?? [],
          ),
      );

      return SubsystemAuditResult.build(checker.subsystem, outcome.value.passedChecks, findings);
    });

    const overallScore = scoring.computeOverallScore(subsystems);
    const recommendedActions = scoring.buildRecommendedActions(subsystems);

    return MultiInstanceSafetyReport.build({
      id: generateId(),
      generatedAt: now(),
      subsystems,
      overallScore,
      recommendedActions,
    });
  }
}
