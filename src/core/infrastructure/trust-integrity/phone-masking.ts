/**
 * Module 93 — Real Fraud & Trust Signal Providers: shared masking helper
 * for phone numbers in structured logs — every log line touching phone
 * reputation (the Twilio Lookup adapter, `CollectFraudTrustSignalsUseCase`)
 * must call this rather than logging `phoneE164` directly. `logger.ts`'s
 * own key-based redaction (`REDACTED_KEY_PATTERN`) does not cover this —
 * a phone number field is not named like a secret — so this is a
 * value-level mask applied before the field ever reaches `logger`.
 *
 * Keeps country code and last 4 digits only, e.g. "+34600123456" →
 * "+34********3456" — enough for a support engineer to recognize "this is
 * a Spanish mobile number" and correlate repeated log lines for the same
 * number without the full number ever appearing in any log aggregator.
 */
export function maskPhoneForLogging(phoneE164: string): string {
  const trimmed = phoneE164.trim();
  const digitsOnly = trimmed.replace(/[^\d]/g, "");
  if (digitsOnly.length < 4) return "***";

  const last4 = digitsOnly.slice(-4);
  const countryMatch = /^\+\d{1,3}/.exec(trimmed);
  const countryPrefix = countryMatch ? countryMatch[0] : "";
  const maskedLength = Math.max(digitsOnly.length - 4 - countryPrefix.replace("+", "").length, 4);

  return `${countryPrefix}${"*".repeat(maskedLength)}${last4}`;
}
