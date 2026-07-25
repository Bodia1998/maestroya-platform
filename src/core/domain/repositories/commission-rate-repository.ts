import type { CommissionRates } from "@/domain/services/commission-policy";

/**
 * Module 22 — Commission & Financial: read seam for the platform's current
 * commission rates. Backed by the existing `PlatformSetting` model (see
 * schema.prisma's own doc comment on that model — "commission rate" is
 * cited there as its first example use case, before this module existed),
 * not a new dedicated table — this is the smallest change that lets ops
 * change the rate without a deploy (see the module spec's "COMMISSION
 * POLICY" requirement).
 *
 * Deliberately read-only: nothing in this module lets a client (customer,
 * professional, or even an admin Server Action) write a rate directly
 * through this interface — changing a rate is an ops/PlatformSetting
 * concern (Module 16's existing settings surface, if any, or a direct DB
 * change), never a Module 22 use case. This keeps "users cannot modify
 * commission rates" (see the module spec's Security section) true by
 * construction rather than by a runtime check.
 */
export interface CommissionRateRepository {
  /**
   * Returns the rates currently in effect. Implementations MUST fall back
   * to DEFAULT_COMMISSION_RATES (see commission-policy.ts) if no
   * PlatformSetting row exists yet, never throw — a missing setting is not
   * an error condition, it just means "use the documented default."
   */
  getCurrentRates(): Promise<CommissionRates>;
}
