import type { PhoneReputationProvider, PhoneReputationResult } from "@/application/ports/phone-reputation-provider";

/**
 * Module 65 — Trust & Integrity System: default `PhoneReputationProvider`
 * used whenever no real lookup provider is configured (Module 93 still
 * selects this whenever `FRAUD_PHONE_REPUTATION_PROVIDER` is unset/`null`
 * or misconfigured — see `trust-integrity-provider-factory.ts`). Reports
 * `valid: true`/`UNKNOWN` with neutral risk rather than penalizing every
 * user just because no real lookup is configured — "signal unavailable"
 * must never be treated as "fraud", the module brief's own rule.
 */
export class NullPhoneReputationProvider implements PhoneReputationProvider {
  readonly name = "NULL";

  async lookup(_phoneE164: string): Promise<PhoneReputationResult> {
    return {
      valid: true,
      lineType: "UNKNOWN",
      riskScore: 0,
      countryCode: null,
      carrierName: null,
      provider: "NULL",
      checkedAt: new Date(),
    };
  }
}
