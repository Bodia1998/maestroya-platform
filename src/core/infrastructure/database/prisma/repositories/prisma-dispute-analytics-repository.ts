import { prisma } from "@/infrastructure/database/prisma/client";
import type { DisputeAnalyticsRepository } from "@/domain/repositories/analytics-extras-repository";
import type { DisputeStatistics } from "@/domain/entities/analytics-dashboard";

/**
 * Module 50 — Analytics Dashboard (CQRS Read Model).
 *
 * All-time, read-only `Dispute` status counts — one bounded `groupBy`
 * query (result size is O(number of `DisputeStatus` enum values), never
 * O(number of disputes)), the same performance shape every Module 23
 * repository already follows. No date range: the dashboard's own KPI is
 * "how many disputes are open right now," an operational snapshot rather
 * than a period-over-period figure — see `AnalyticsDashboardAssembler`'s
 * own doc comment for why the whole read model is unranged.
 */
export class PrismaDisputeAnalyticsRepository implements DisputeAnalyticsRepository {
  async getStatistics(): Promise<DisputeStatistics> {
    const grouped = await prisma.dispute.groupBy({
      by: ["status"],
      _count: { _all: true },
    });

    const countOf = (...statuses: string[]): number =>
      grouped.filter((row) => statuses.includes(row.status)).reduce((sum, row) => sum + row._count._all, 0);

    return {
      total: grouped.reduce((sum, row) => sum + row._count._all, 0),
      open: countOf("OPEN"),
      underReview: countOf("UNDER_REVIEW"),
      waitingOnParty: countOf("WAITING_FOR_CUSTOMER", "WAITING_FOR_PROFESSIONAL"),
      resolved: countOf("RESOLVED"),
      rejected: countOf("REJECTED"),
      closed: countOf("CLOSED"),
    };
  }
}
