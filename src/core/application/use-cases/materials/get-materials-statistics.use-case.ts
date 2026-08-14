import { prisma } from "@/infrastructure/database/prisma/client";

/**
 * Module 63 — Materials Procurement Workflow: a small read-only rollup for
 * `npm run materials-report`, same "one-off statistics use case feeding a
 * report script" pattern as GetReferralStatisticsUseCase (Module 60).
 * Deliberately queries `prisma` directly (via aggregate/count, never
 * `findMany` over every Quote) rather than adding bespoke aggregate
 * methods to `QuoteRepository` — this is reporting-only, not a
 * business-rule dependency any use case needs.
 */
export interface MaterialsStatistics {
  totalQuotes: number;
  professionalSuppliedQuotes: number;
  customerPurchasedQuotes: number;
  customerPurchasedConfirmed: number;
  customerPurchasedAwaitingConfirmation: number;
  totalMaterialsListed: number;
}

export class GetMaterialsStatisticsUseCase {
  async execute(): Promise<MaterialsStatistics> {
    const [totalQuotes, professionalSuppliedQuotes, customerPurchasedQuotes, customerPurchasedConfirmed, totalMaterialsListed] =
      await Promise.all([
        prisma.quote.count(),
        prisma.quote.count({ where: { materialsStrategy: "PROFESSIONAL_SUPPLIED" } }),
        prisma.quote.count({ where: { materialsStrategy: "CUSTOMER_PURCHASED" } }),
        prisma.quote.count({
          where: { materialsStrategy: "CUSTOMER_PURCHASED", materialsConfirmedAt: { not: null } },
        }),
        prisma.quoteMaterial.count(),
      ]);

    return {
      totalQuotes,
      professionalSuppliedQuotes,
      customerPurchasedQuotes,
      customerPurchasedConfirmed,
      customerPurchasedAwaitingConfirmation: customerPurchasedQuotes - customerPurchasedConfirmed,
      totalMaterialsListed,
    };
  }
}
