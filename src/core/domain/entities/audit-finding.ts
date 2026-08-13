import { ValidationError } from "@/domain/errors/domain-error";

/**
 * Module 58 — Multi-Instance Safety Audit.
 *
 * `AuditFinding` is the unit of "something a reviewer needs to look at" —
 * the same role `CapacityBottleneck` plays for Module 57, but structured
 * for a *safety* review rather than a *capacity* one. A finding never
 * represents a passing check (see `SubsystemAuditResult.passedChecks` for
 * that) — it exists only for `WARNING`/`CRITICAL` severities, because a
 * "SAFE finding" with a Problem/Risk/Impact would be a contradiction in
 * terms. Subsystem-level status (`SAFE`/`WARNING`/`CRITICAL`, see
 * `SubsystemAuditResult`) is *derived* from the worst finding present,
 * not stored redundantly here.
 *
 * Every field mirrors the report content this whole module exists to
 * produce: Problem, Risk, Why it happens, Impact, Recommended fix,
 * Priority. All six free-text fields are required and non-empty by
 * construction — a finding with a blank "recommendedFix" would defeat
 * the entire point of an audit report a reviewer is meant to act on.
 */
export type AuditFindingSeverity = "WARNING" | "CRITICAL";

export type AuditFindingPriority = "LOW" | "MEDIUM" | "HIGH" | "CRITICAL";

export class AuditFinding {
  constructor(
    readonly id: string,
    /** The subsystem this finding belongs to, e.g. "Distributed Locking" — matches `SafetyChecker.subsystem`. */
    readonly subsystem: string,
    readonly severity: AuditFindingSeverity,
    /** What is wrong, stated as an observation, not a question. */
    readonly problem: string,
    /** What could go wrong in production because of it. */
    readonly risk: string,
    /** The mechanism — why this is possible given how multiple instances actually run. */
    readonly whyItHappens: string,
    /** The concrete, user-visible or data-integrity consequence. */
    readonly impact: string,
    /** A concrete, actionable remediation — never "investigate further". */
    readonly recommendedFix: string,
    readonly priority: AuditFindingPriority,
    /** File paths / grep evidence this finding is grounded in — never empty for a static-analysis finding; see individual checkers. */
    readonly evidence: readonly string[] = [],
  ) {
    for (const [field, value] of Object.entries({
      id,
      subsystem,
      problem,
      risk,
      whyItHappens,
      impact,
      recommendedFix,
    })) {
      if (!value.trim()) {
        throw new ValidationError(`AuditFinding.${field} must not be empty.`);
      }
    }
  }
}
