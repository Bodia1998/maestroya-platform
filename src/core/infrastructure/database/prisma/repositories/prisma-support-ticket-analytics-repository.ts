import { prisma } from "@/infrastructure/database/prisma/client";
import type { SupportTicketAnalyticsRepository } from "@/domain/repositories/analytics-extras-repository";
import type { SupportTicketStatistics } from "@/domain/entities/analytics-dashboard";

/**
 * Module 50 — Analytics Dashboard (CQRS Read Model).
 *
 * All-time, read-only `SupportTicket` status counts — same shape and
 * reasoning as `PrismaDisputeAnalyticsRepository`.
 */
export class PrismaSupportTicketAnalyticsRepository implements SupportTicketAnalyticsRepository {
  async getStatistics(): Promise<SupportTicketStatistics> {
    const grouped = await prisma.supportTicket.groupBy({
      by: ["status"],
      _count: { _all: true },
    });

    const countOf = (...statuses: string[]): number =>
      grouped.filter((row) => statuses.includes(row.status)).reduce((sum, row) => sum + row._count._all, 0);

    return {
      total: grouped.reduce((sum, row) => sum + row._count._all, 0),
      open: countOf("OPEN"),
      inProgress: countOf("IN_PROGRESS"),
      waitingForUser: countOf("WAITING_FOR_USER"),
      resolved: countOf("RESOLVED"),
      closed: countOf("CLOSED"),
    };
  }
}
