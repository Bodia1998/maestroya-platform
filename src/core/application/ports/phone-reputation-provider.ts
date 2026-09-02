/**
 * Module 65 — Trust & Integrity System (requirement #8), revised by
 * Module 93 — Real Fraud & Trust Signal Providers. Real provider: Twilio
 * Lookup v2 (`line_type_intelligence`) — see the adapter's own doc
 * comment for why Twilio was selected over Numverify for this codebase.
 */
export type PhoneLineType = "MOBILE" | "LANDLINE" | "VOIP" | "UNKNOWN";

export interface PhoneReputationResult {
  valid: boolean;
  lineType: PhoneLineType;
  /** 0-100 — MaestroYa's own risk heuristic derived from `valid`/
   *  `lineType` (see the adapter's own doc comment for the exact
   *  mapping) — not a fraud score Twilio Lookup itself returns; Twilio's
   *  API does not expose one on the `line_type_intelligence` package this
   *  adapter uses. Documented here rather than left implicit so a future
   *  reader never mistakes this for a vendor-supplied score. */
  riskScore: number;
  countryCode: string | null;
  /** Set only when the provider returns one (IPQS-style "unsupported
   *  field stays null" convention) — Twilio Lookup's carrier name for
   *  this line, e.g. "Movistar España". */
  carrierName: string | null;
  provider: string;
  checkedAt: Date;
}

export interface PhoneReputationProvider {
  readonly name: string;
  /** `phoneE164` — always E.164 (`+34XXXXXXXXX`); this port, its adapters,
   *  and every caller must never log this parameter's raw value — see
   *  each adapter's own "masked logging" section and
   *  `maskPhoneForLogging` (infrastructure/trust-integrity/
   *  phone-masking.ts). Never throws for "provider unavailable" — see
   *  `PhoneReputationProviderError` for the one exception (a genuine
   *  provider-side failure), which `CollectFraudTrustSignalsUseCase`
   *  always catches and downgrades to an unavailable signal. */
  lookup(phoneE164: string): Promise<PhoneReputationResult>;
}
