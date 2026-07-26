/**
 * Security & Anti-Abuse module (Module 24): the one place every rate-limit
 * policy's (limit, windowMs) pair lives — no magic numbers scattered
 * across Server Actions/use cases. Each policy name doubles as the
 * `RateLimitRepository` key prefix (see domain/services/security-key.ts's
 * `buildRateLimitKey`).
 *
 * Only high-risk/high-frequency, realistically-abusable operations get a
 * policy here — read-only requests are deliberately never rate-limited
 * (see docs/MODULE_24_SECURITY_ANTI_ABUSE.md, "Rate limiting").
 *
 * Two entries per identity type for auth flows (e.g. LOGIN_BY_EMAIL vs
 * LOGIN_BY_IP) — both are enforced together (see AntiAbuseService), so a
 * single leaked/guessed email can't be brute-forced from one IP (email
 * limit) and a botnet can't spread one target across many emails from a
 * shared IP range without also tripping the IP limit.
 */
export interface RateLimitPolicy {
  /** Max attempts allowed within `windowMs`. */
  limit: number;
  /** Window size in milliseconds. */
  windowMs: number;
}

const MINUTE = 60 * 1000;
const HOUR = 60 * MINUTE;

export const RATE_LIMIT_POLICIES = {
  // --- Auth abuse (A) ---
  LOGIN_BY_EMAIL: { limit: 5, windowMs: 15 * MINUTE },
  LOGIN_BY_IP: { limit: 20, windowMs: 15 * MINUTE },
  PASSWORD_RESET_REQUEST_BY_EMAIL: { limit: 3, windowMs: HOUR },
  PASSWORD_RESET_REQUEST_BY_IP: { limit: 10, windowMs: HOUR },
  EMAIL_VERIFICATION_RESEND_BY_USER: { limit: 3, windowMs: HOUR },

  // --- Registration abuse (B) ---
  REGISTRATION_BY_IP: { limit: 5, windowMs: HOUR },

  // --- Marketplace abuse (C) ---
  SERVICE_REQUEST_CREATE_BY_USER: { limit: 10, windowMs: HOUR },
  QUOTE_CREATE_BY_USER: { limit: 30, windowMs: HOUR },

  // --- Communication abuse (D) ---
  MESSAGE_SEND_BY_USER: { limit: 60, windowMs: 10 * MINUTE },

  // --- Review abuse (E) ---
  REVIEW_CREATE_BY_USER: { limit: 10, windowMs: HOUR },

  // --- Financial-sensitive ops observable today (F) — Module 22's own
  // FinancialAdjustment already has a DB-level idempotencyKey (see
  // financial-adjustment-repository.ts); this policy is the additional
  // *frequency* guard ("don't let one admin/support account fire off
  // dozens of adjustment requests a minute", e.g. a compromised admin
  // session) on top of that per-request idempotency guarantee.
  FINANCIAL_ADJUSTMENT_CREATE_BY_USER: { limit: 20, windowMs: HOUR },
} as const;

export type RateLimitPolicyName = keyof typeof RATE_LIMIT_POLICIES;
