import type { AuditFindingPriority, AuditFindingSeverity } from "@/domain/entities/audit-finding";

/**
 * Module 58 — Multi-Instance Safety Audit.
 *
 * The seam application code depends on for actually inspecting one
 * subsystem — the same Dependency Inversion boundary `LoadTestExecutor`
 * draws for Module 57. A `SafetyChecker` never constructs an `AuditFinding`
 * itself (that would let two checkers hand out colliding ids, and would
 * scatter the "must belong to my own subsystem" invariant `SubsystemAuditResult.build`
 * enforces across every implementation); it returns plain data instead,
 * and `RunMultiInstanceSafetyAuditUseCase` is the single place ids are
 * minted and `AuditFinding`/`SubsystemAuditResult` instances are built.
 */
export interface CheckerFindingInput {
  readonly severity: AuditFindingSeverity;
  readonly problem: string;
  readonly risk: string;
  readonly whyItHappens: string;
  readonly impact: string;
  readonly recommendedFix: string;
  readonly priority: AuditFindingPriority;
  readonly evidence?: readonly string[];
}

export interface SubsystemCheckOutcome {
  readonly passedChecks: readonly string[];
  readonly findings: readonly CheckerFindingInput[];
}

export interface SafetyChecker {
  /** Stable, human-readable subsystem name — becomes `AuditFinding.subsystem`/`SubsystemAuditResult.subsystem` verbatim. */
  readonly subsystem: string;

  /**
   * Performs this subsystem's inspection — real static/code-level
   * analysis of the actual repository (grep-equivalent pattern matching
   * over source files, combined with documented reasoning about the
   * pattern found), never a hardcoded result. Must not throw for an
   * expected "file not found"/"pattern absent" outcome — those are
   * findings, not exceptions; a thrown error here is treated by the use
   * case as the checker itself having failed (see
   * `RunMultiInstanceSafetyAuditUseCase`'s own doc comment).
   */
  check(): Promise<SubsystemCheckOutcome>;
}
