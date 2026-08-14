/**
 * Module 65 — Trust & Integrity System: requirement #8 — phone reputation
 * provider abstraction (future providers: Twilio Lookup, Numverify, ...).
 * Architecture only — no external SDK is integrated.
 */
export type PhoneLineType = "MOBILE" | "LANDLINE" | "VOIP" | "UNKNOWN";

export interface PhoneReputationResult {
  valid: boolean;
  lineType: PhoneLineType;
  /** 0-100 — the provider's own confidence that this number belongs to a
   *  genuine, reachable subscriber (a VOIP/burner number scores low). */
  riskScore: number;
  countryCode: string | null;
}

export interface PhoneReputationProvider {
  readonly name: string;
  lookup(phoneE164: string): Promise<PhoneReputationResult>;
}
