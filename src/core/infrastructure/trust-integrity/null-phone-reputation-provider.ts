import type { PhoneReputationProvider, PhoneReputationResult } from "@/application/ports/phone-reputation-provider";

/**
 * Module 65 — Trust & Integrity System: default `PhoneReputationProvider`
 * — architecture only (requirement #8), no Twilio Lookup/Numverify
 * integration. Reports `valid: true`/`UNKNOWN` with neutral risk rather
 * than penalizing every user just because no real lookup is configured.
 */
export class NullPhoneReputationProvider implements PhoneReputationProvider {
  readonly name = "NULL";

  async lookup(_phoneE164: string): Promise<PhoneReputationResult> {
    return { valid: true, lineType: "UNKNOWN", riskScore: 0, countryCode: null };
  }
}
