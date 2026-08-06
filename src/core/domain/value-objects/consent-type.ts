/**
 * Module 38 — GDPR Compliance.
 *
 * The fixed vocabulary of consent a user can grant/withdraw on this
 * platform. Kept as a small string-union value object — same convention as
 * `payment-status.ts`/`notification-category.ts` — rather than importing a
 * generated Prisma enum type into the domain layer.
 *
 * - `TERMS_OF_SERVICE` — acceptance of the platform's terms of use.
 * - `PRIVACY_POLICY` — acceptance of the privacy policy (how personal data
 *   is processed).
 * - `MARKETING` — opt-in to marketing communications; the only one of the
 *   three that is expected to ever legitimately be withdrawn without also
 *   closing the account (a user can keep using the platform after opting
 *   out of marketing, but cannot keep using it after withdrawing acceptance
 *   of the Terms/Privacy Policy — enforcing that is out of scope for this
 *   module, which only *tracks* consent state, see gdpr-privacy-rules.ts).
 */
export const CONSENT_TYPES = ["TERMS_OF_SERVICE", "PRIVACY_POLICY", "MARKETING"] as const;

export type ConsentTypeValue = (typeof CONSENT_TYPES)[number];

export function isConsentType(value: unknown): value is ConsentTypeValue {
  return typeof value === "string" && (CONSENT_TYPES as readonly string[]).includes(value);
}
