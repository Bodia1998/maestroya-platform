import type { AuditFinding } from "@/domain/entities/audit-finding";
import { ValidationError } from "@/domain/errors/domain-error";

/**
 * Module 58 — Multi-Instance Safety Audit.
 *
 * One checker's complete output for one subsystem (e.g. "Distributed
 * Locking", "Stripe Webhook Idempotency", "Background Workers"). Built
 * only via the named factory `SubsystemAuditResult.build`, mirroring
 * `LoadTestResult.schedule()`'s "aggregates come from a named factory"
 * convention — `status` is *derived*, never caller-supplied, so it can
 * never drift out of sync with the findings it is meant to summarize.
 */
export type SubsystemStatus = "SAFE" | "WARNING" | "CRITICAL";

export class SubsystemAuditResult {
  private constructor(
    readonly subsystem: string,
    readonly status: SubsystemStatus,
    readonly passedChecks: readonly string[],
    readonly findings: readonly AuditFinding[],
  ) {}

  static build(subsystem: string, passedChecks: readonly string[], findings: readonly AuditFinding[]): SubsystemAuditResult {
    if (!subsystem.trim()) {
      throw new ValidationError("SubsystemAuditResult.subsystem must not be empty.");
    }
    for (const finding of findings) {
      if (finding.subsystem !== subsystem) {
        throw new ValidationError(
          `SubsystemAuditResult.build: finding ${JSON.stringify(finding.id)} belongs to subsystem ${JSON.stringify(finding.subsystem)}, not ${JSON.stringify(subsystem)}.`,
        );
      }
    }

    const status: SubsystemStatus = findings.some((f) => f.severity === "CRITICAL")
      ? "CRITICAL"
      : findings.some((f) => f.severity === "WARNING")
        ? "WARNING"
        : "SAFE";

    return new SubsystemAuditResult(subsystem, status, passedChecks, findings);
  }

  get warnings(): readonly AuditFinding[] {
    return this.findings.filter((f) => f.severity === "WARNING");
  }

  get criticalIssues(): readonly AuditFinding[] {
    return this.findings.filter((f) => f.severity === "CRITICAL");
  }
}
