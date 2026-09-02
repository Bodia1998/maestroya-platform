import { timingSafeEqual } from "node:crypto";

/**
 * Module 95 — API Security Hardening: shared timing-safe comparison for
 * the `Authorization: Bearer $CRON_SECRET` check every cron route in this
 * codebase performs (expire-workflows, gdpr-cloudinary-purge,
 * reconciliation-run — see each route's own doc comment for the full
 * Vercel Cron auth pattern this backs).
 *
 * Before this module, each route compared the header to the expected
 * value with plain `!==` string comparison. `!==` on strings short-
 * circuits at the first mismatched character/length, so its execution
 * time leaks how many leading characters of a guess were correct — the
 * same class of timing side-channel `PersonaVerificationProvider` and
 * `StripeConnectWebhookVerifier` already defend against for their own
 * webhook-signature checks (see persona-verification-provider.ts's own
 * doc comment). `CRON_SECRET` never needed the same defense as badly, but
 * an inconsistency between "this codebase's other secret comparisons are
 * timing-safe" and "this one silently isn't" is exactly the kind of gap a
 * security audit exists to catch — Vercel Cron's bearer token is a static,
 * long-lived, network-reachable (if unauthenticated) secret, so guessing
 * it via repeated timing measurements is the same threat model
 * `timingSafeEqual` protects against elsewhere in this codebase.
 *
 * `timingSafeEqual` throws on a length mismatch rather than returning
 * `false`, so the length check happens first — deliberately using
 * `Buffer.byteLength` (UTF-8 byte length) rather than `.length` (UTF-16
 * code units) so a header containing non-ASCII bytes can never make the
 * two lengths compare unequal via `.length` while their `Buffer`
 * encodings are actually equal length, and vice-versa.
 */
export function isValidCronAuthHeader(authHeader: string | null, expectedSecret: string): boolean {
  if (!authHeader) return false;

  const expected = `Bearer ${expectedSecret}`;
  const expectedBuffer = Buffer.from(expected, "utf8");
  const providedBuffer = Buffer.from(authHeader, "utf8");

  if (expectedBuffer.length !== providedBuffer.length) return false;

  return timingSafeEqual(expectedBuffer, providedBuffer);
}
