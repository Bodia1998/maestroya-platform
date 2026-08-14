import { createHash } from "node:crypto";

/**
 * Security & Anti-Abuse module (Module 24): privacy-conscious key-building
 * helpers shared by rate limiting, security-event logging, and abuse
 * detection. Pure/dependency-free (like money.ts, geo-distance.ts) except
 * for Node's built-in `crypto` — the same "domain code may use Node
 * built-ins, just never Prisma/Stripe/an external SDK" convention
 * infrastructure/auth/tokens.ts already establishes for password-reset/
 * email-verification tokens.
 *
 * Never stores or logs a raw IP address anywhere (see SecurityEvent's own
 * doc comment in schema.prisma) — every caller must hash it first with
 * `hashIp` before it reaches a repository, a log line, or a metadata blob.
 */

/**
 * Keyed SHA-256 hash of a raw IP address. Keyed (not a bare hash) so the
 * hash can't be trivially reversed by brute-forcing the IPv4/IPv6 address
 * space (a bare SHA-256 of an IP is crackable in seconds — there are only
 * ~4 billion IPv4 addresses). `pepper` is a server-side secret (see
 * infrastructure/auth/security-key.ts, which supplies it from `env`) —
 * never derived from user input, never persisted alongside the hash.
 */
export function hashIp(rawIp: string, pepper: string): string {
  return createHash("sha256").update(`${pepper}:ip:${rawIp}`).digest("hex");
}

/**
 * Module 62 — Professional Onboarding: generic keyed-hash helper for any
 * other raw sensitive value that must never be persisted or logged in the
 * clear (e.g. a professional's IBAN, kept only for duplicate-destination
 * detection — see `professional-onboarding-rules.ts`'s `isValidIban`/
 * `maskIban` and `ProfessionalPayoutAccountRecord.ibanHash`). `context`
 * namespaces the hash the same way `hashIp`'s hard-coded `"ip"` segment
 * does, so the same raw value hashed under two different contexts never
 * collides.
 */
export function hashSecret(rawValue: string, pepper: string, context: string): string {
  return createHash("sha256").update(`${pepper}:${context}:${rawValue}`).digest("hex");
}

/** Caps how much of a User-Agent string is ever persisted — these can be
 *  arbitrarily long and are only useful here as a coarse "same client
 *  again?" signal, not as a field to store in full. */
const MAX_USER_AGENT_LENGTH = 200;

export function truncateUserAgent(userAgent: string | null | undefined): string | null {
  if (!userAgent) return null;
  const trimmed = userAgent.trim();
  if (!trimmed) return null;
  return trimmed.length > MAX_USER_AGENT_LENGTH ? trimmed.slice(0, MAX_USER_AGENT_LENGTH) : trimmed;
}

/**
 * Builds a rate-limit bucket key from whichever identifying parts are
 * available for a given policy. `policyName` is always the first
 * component so unrelated policies never collide even if they happen to
 * share a user/IP (e.g. LOGIN vs REGISTRATION for the same IP hash).
 * `resource` lets a policy be scoped to a specific target — e.g. "one
 * quote per (professional, serviceRequest) per minute" — without a
 * separate key-building function per operation.
 */
export function buildRateLimitKey(
  policyName: string,
  parts: { userId?: string | null; ipHash?: string | null; resource?: string | null },
): string {
  const segments = [policyName];
  if (parts.userId) segments.push(`user:${parts.userId}`);
  if (parts.ipHash) segments.push(`ip:${parts.ipHash}`);
  if (parts.resource) segments.push(`resource:${parts.resource}`);

  if (segments.length === 1) {
    throw new RangeError(
      `buildRateLimitKey("${policyName}") needs at least one of userId/ipHash/resource to avoid a shared, unbounded key.`,
    );
  }

  return segments.join("|");
}

/**
 * Deterministic fingerprint of free-text content (a service-request
 * description, a chat message body, a review comment) used for duplicate-
 * content detection — never reversible back to the original text, and
 * never intended to be (it's compared to other hashes, never displayed).
 * Normalizes whitespace/case first so trivial variations ("Hello!" vs
 * "hello!" vs "Hello !") still collide.
 */
export function contentFingerprint(text: string): string {
  const normalized = text.trim().toLowerCase().replace(/\s+/g, " ");
  return createHash("sha256").update(normalized).digest("hex");
}
