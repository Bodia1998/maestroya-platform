import type { SubsystemAuditResult } from "@/domain/entities/subsystem-audit-result";

/**
 * Module 58 — Multi-Instance Safety Audit.
 *
 * `AuditScoringService` turns a set of `SubsystemAuditResult`s into the
 * report's headline `overallScore` and its `recommendedActions` list —
 * the same role `PerformanceAnalysisService.computeProductionReadinessScore`
 * plays for Module 57: an additive, fully transparent penalty model, no
 * black-box formula.
 *
 * ## The scoring formula
 * Starts at 100. Every `CRITICAL` finding deducts a priority-weighted
 * penalty (`CRITICAL_PENALTY_BY_PRIORITY`); every `WARNING` finding
 * deducts a flat `WARNING_PENALTY`. The result is clamped to `[0, 100]` —
 * a report with many critical issues bottoms out at 0 rather than going
 * negative, matching `MultiInstanceSafetyReport.build`'s own `0..100`
 * validation.
 */
const CRITICAL_PENALTY_BY_PRIORITY: Record<"LOW" | "MEDIUM" | "HIGH" | "CRITICAL", number> = {
  LOW: 8,
  MEDIUM: 12,
  HIGH: 18,
  CRITICAL: 25,
};

const WARNING_PENALTY = 5;

/** Caps how many recommended actions the report surfaces — same "worst first, capped" convention `PerformanceAnalysisService.identifyBottlenecks` uses. */
const MAX_RECOMMENDED_ACTIONS = 10;

export class AuditScoringService {
  computeOverallScore(subsystems: readonly SubsystemAuditResult[]): number {
    let score = 100;

    for (const subsystem of subsystems) {
      for (const finding of subsystem.criticalIssues) {
        score -= CRITICAL_PENALTY_BY_PRIORITY[finding.priority];
      }
      score -= subsystem.warnings.length * WARNING_PENALTY;
    }

    return Math.max(0, Math.min(100, score));
  }

  /**
   * Ranks every finding's `recommendedFix` worst-first (critical before
   * warning, then by priority within each severity), deduplicates
   * identical recommendations (two checkers can legitimately converge on
   * the same fix), and caps the list — a report a reviewer can actually
   * act on, not an unranked wall of text.
   */
  buildRecommendedActions(subsystems: readonly SubsystemAuditResult[]): string[] {
    const priorityRank: Record<"LOW" | "MEDIUM" | "HIGH" | "CRITICAL", number> = { CRITICAL: 0, HIGH: 1, MEDIUM: 2, LOW: 3 };

    const ranked = subsystems
      .flatMap((s) => s.findings)
      .slice()
      .sort((a, b) => {
        if (a.severity !== b.severity) return a.severity === "CRITICAL" ? -1 : 1;
        return priorityRank[a.priority] - priorityRank[b.priority];
      });

    const seen = new Set<string>();
    const actions: string[] = [];
    for (const finding of ranked) {
      const action = `[${finding.subsystem}] ${finding.recommendedFix}`;
      if (seen.has(action)) continue;
      seen.add(action);
      actions.push(action);
      if (actions.length >= MAX_RECOMMENDED_ACTIONS) break;
    }
    return actions;
  }
}
