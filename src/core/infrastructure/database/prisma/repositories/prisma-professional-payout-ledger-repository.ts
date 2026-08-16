import { prisma } from "@/infrastructure/database/prisma/client";
import type { ProfessionalPayoutLedgerRepository } from "@/domain/repositories/professional-payout-ledger-repository";

export class PrismaProfessionalPayoutLedgerRepository implements ProfessionalPayoutLedgerRepository {
  async sumPaidForProfessional(professionalProfileId: string): Promise<number> {
    const result = await prisma.payout.aggregate({
      where: { professionalProfileId, status: "PAID" },
      _sum: { amount: true },
    });
    return Number(result._sum.amount ?? 0);
  }
}
