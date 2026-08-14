import { prisma } from "@/infrastructure/database/prisma/client";
import type { CommissionRateRepository } from "@/domain/repositories/commission-rate-repository";
import { DEFAULT_COMMISSION_RATES, type CommissionRates } from "@/domain/services/commission-policy";

/**
 * Module 22 — Commission & Financial (rate storage), updated for Module
 * 64's flat single-rate model: reads MaestroYa's current flat commission
 * rate from the existing `PlatformSetting` key/value table under the
 * `default_commission_rate_bps` key — the same key `prisma/seed.ts`
 * already seeds at 1000 bps (10%), anticipating this module. Replaces the
 * two independent `commission.customerPlatformFeeRateBps`/
 * `commission.professionalCommissionRateBps` keys the removed dual-fee
 * model used — those keys are no longer read anywhere; a stale row under
 * either old key has no effect.
 */
const COMMISSION_RATE_KEY = "default_commission_rate_bps";

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
    const row = await prisma.platformSetting.findUnique({
      where: { key: COMMISSION_RATE_KEY },
      select: { value: true },
    });

    return {
      commissionRateBps: parseBpsSetting(row?.value, DEFAULT_COMMISSION_RATES.commissionRateBps),
    };
  }
}
