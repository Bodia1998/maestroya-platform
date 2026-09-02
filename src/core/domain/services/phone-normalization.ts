/**
 * Module 93 — Real Fraud & Trust Signal Providers: minimal E.164
 * normalization for `PhoneReputationProvider.lookup`, which requires
 * E.164 input (Twilio Lookup's own documented requirement). Existing
 * phone-collecting schemas (`professionalOnboardingSchema.contactPhone`)
 * accept a looser `+?[0-9\s-]{7,20}` shape — spaces/dashes allowed,
 * country code optional — for form-usability reasons unrelated to this
 * module; this is the one small, pure normalization step between "what
 * the form accepted" and "what the Lookup API requires."
 *
 * Deliberately narrow: this platform is Spain/EU-facing (see
 * `FINGERPRINTJS_REGION`'s own default) — a number with no leading `+`
 * is assumed Spanish (`+34`) rather than attempting general-purpose
 * international parsing (a full libphonenumber-style parser is out of
 * scope for this module; see the implementation report's "Known
 * limitations"). Returns `null` for anything that still doesn't look
 * like a plausible E.164 number after normalization — the caller treats
 * `null` as "skip the phone-reputation check", never as a validation
 * error (this function is never used for the form's own validation,
 * only to decide whether a real lookup call is worth attempting).
 */
export function toE164(rawPhone: string, defaultCountryCode = "+34"): string | null {
  const digitsAndPlus = rawPhone.trim().replace(/[\s-]/g, "");
  const withCountryCode = digitsAndPlus.startsWith("+") ? digitsAndPlus : `${defaultCountryCode}${digitsAndPlus.replace(/^0+/, "")}`;

  return /^\+[1-9]\d{6,14}$/.test(withCountryCode) ? withCountryCode : null;
}
