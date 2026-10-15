import type { LegacyWindDownReader } from "@/domain/repositories/legacy-wind-down-reader";
import {
  LEGACY_WIND_DOWN_NOTICE,
  LEGACY_WIND_DOWN_RULES_VERSION,
  evaluateLegacyWindDown,
  type LegacyWindDownEvaluation,
  type LegacyWindDownFindingCode,
  type LegacyWindDownSeverity,
} from "@/domain/services/legacy-wind-down";

export interface LegacyWindDownReport extends LegacyWindDownEvaluation {
  rulesVersion: string;
  /** Always present: an inventory of persisted records, never a compliance statement and never a Gate C verdict. */
  notice: string;
  /** Wall-clock time of the run: the only non-deterministic field. */
  generatedAt: Date;
  summary: {
    totalItems: number;
    totalObjects: number;
    bySeverity: Record<LegacyWindDownSeverity, number>;
    byCode: Partial<Record<LegacyWindDownFindingCode, number>>;
  };
}

const SEVERITIES: readonly LegacyWindDownSeverity[] = ["INFO", "WARNING", "ERROR", "CRITICAL"];

/**
 * Module 166 — builds the legacy wind-down inventory and readiness view. READ-ONLY.
 *
 * It reads one consistent snapshot through a query-only port, evaluates the pure rules and returns the result. It persists
 * nothing, settles nothing, refunds nothing, pays nothing, resolves nothing and touches no status. TRUSTED-INTERNAL: it is wired
 * to no route, Server Action, webhook, cron job, queue or scheduler (pinned by a static test); the only entry point is
 * `scripts/run-legacy-wind-down-report.ts`. Unexpected errors (database, scope limit) propagate — they are never turned into an
 * empty "clean" report, so unavailable or contradictory state fails closed.
 */
export class GenerateLegacyWindDownReportUseCase {
  constructor(
    private readonly reader: LegacyWindDownReader,
    private readonly now: () => Date = () => new Date(),
  ) {}

  async execute(): Promise<LegacyWindDownReport> {
    const snapshot = await this.reader.readSnapshot();
    const evaluation = evaluateLegacyWindDown(snapshot);

    const bySeverity = Object.fromEntries(SEVERITIES.map((s) => [s, 0])) as Record<LegacyWindDownSeverity, number>;
    const byCode: Partial<Record<LegacyWindDownFindingCode, number>> = {};
    let totalObjects = 0;
    for (const item of evaluation.items) {
      bySeverity[item.severity] += 1;
      byCode[item.code] = item.count;
      totalObjects += item.count;
    }

    return {
      ...evaluation,
      rulesVersion: LEGACY_WIND_DOWN_RULES_VERSION,
      notice: LEGACY_WIND_DOWN_NOTICE,
      generatedAt: this.now(),
      summary: { totalItems: evaluation.items.length, totalObjects, bySeverity, byCode },
    };
  }
}
