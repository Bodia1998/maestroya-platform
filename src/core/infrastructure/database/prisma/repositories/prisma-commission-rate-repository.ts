import { prisma } from "@/infrastructure/database/prisma/client";
import type { CommissionRateRepository } from "@/domain/repositories/commission-rate-repository";
import { DEFAULT_COMMISSION_RATES, type CommissionRates } from "@/domain/services/commission-policy";

/**
 * Module 22 — Commission & Financial: reads commission rates from the
 * existing `PlatformSetting` key/value table (see schema.prisma's doc
 * comment on that model — "commission rate" is its own first cited
 * example use case). Two independent keys, not one JSON blob, so ops can
 * change just the customer fee or just the professional commission
 * without needing to know the other's current value.
 */
const CUSTOMER_PLATFORM_FEE_RATE_KEY = "commission.customerPlatformFeeRateBps";
const PROFESSIONAL_COMMISSION_RATE_KEY = "commission.professionalCommissionRateBps";

function parseBpsSetting(value: unknown, fallback: number): number {
  if (typeof value === "number" && Number.isFinite(value) && value >= 0) {
    return value;
  }
  // PlatformSetting.value is Json — a plain number is stored (and read
  // back) as a JS number by Prisma's Json handling, but guard against a
  // malformed/legacy value (e.g. a string) rather than propagating NaN
  // into a financial calculation.
  return fallback;
}

export class PrismaCommissionRateRepository implements CommissionRateRepository {
  async getCurrentRates(): Promise<CommissionRates> {
    const rows = await prisma.platformSetting.findMany({
      where: { key: { in: [CUSTOMER_PLATFORM_FEE_RATE_KEY, PROFESSIONAL_COMMISSION_RATE_KEY] } },
      select: { key: true, value: true },
    });

    const byKey = new Map(rows.map((row) => [row.key, row.value]));

    return {
      customerPlatformFeeRateBps: parseBpsSetting(
        byKey.get(CUSTOMER_PLATFORM_FEE_RATE_KEY),
        DEFAULT_COMMISSION_RATES.customerPlatformFeeRateBps,
      ),
      professionalCommissionRateBps: parseBpsSetting(
        byKey.get(PROFESSIONAL_COMMISSION_RATE_KEY),
        DEFAULT_COMMISSION_RATES.professionalCommissionRateBps,
      ),
    };
  }
}
