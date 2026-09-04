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

  // --- File upload abuse (Module 33 — Security Hardening) — every
  // Cloudinary-backed upload Server Action (avatar, service-request photo,
  // professional/company verification documents) was previously
  // unrestricted in frequency: file-type/size were validated, but nothing
  // stopped an authenticated account from uploading in a tight loop,
  // running up Cloudinary storage/bandwidth cost or degrading the upload
  // pipeline for everyone else. One shared per-user policy across all
  // upload actions (not one policy per action) — this is a resource-cost
  // control, not a per-feature business rule, so a single generous budget
  // covering "how many uploads can one account push per hour" is the
  // right shape, mirroring how LOGIN_BY_EMAIL/LOGIN_BY_IP are two views of
  // one concern rather than a policy per provider.
  FILE_UPLOAD_BY_USER: { limit: 30, windowMs: HOUR },

  // --- Financial-sensitive ops observable today (F) — Module 22's own
  // FinancialAdjustment already has a DB-level idempotencyKey (see
  // financial-adjustment-repository.ts); this policy is the additional
  // *frequency* guard ("don't let one admin/support account fire off
  // dozens of adjustment requests a minute", e.g. a compromised admin
  // session) on top of that per-request idempotency guarantee.
  FINANCIAL_ADJUSTMENT_CREATE_BY_USER: { limit: 20, windowMs: HOUR },

  // --- Module 96 — Referral & Affiliate Production Wiring (G) ---
  // `/r/[code]` is public and unauthenticated by design (a shared
  // marketing link) — IP is the only signal available, same trade-off
  // REGISTRATION_BY_IP already makes. Generous enough that a real,
  // organically-shared link posted somewhere popular is never throttled
  // (302 redirects are cheap; this budget governs the TrackVisitUseCase
  // *write*, not the redirect itself — see that route's own doc comment
  // on why the redirect is never blocked).
  REFERRAL_CLICK_BY_IP: { limit: 120, windowMs: MINUTE },
  // A partner creating their own referral link — mirrors
  // QUOTE_CREATE_BY_USER's budget shape (a legitimate partner running
  // several campaigns needs headroom; a scripted flood does not).
  REFERRAL_LINK_CREATE_BY_USER: { limit: 20, windowMs: HOUR },
  // Every admin partner/commission/fraud-flag mutation shares one budget
  // — same "one shared per-resource-class policy, not one per action"
  // convention FILE_UPLOAD_BY_USER already establishes — generous for a
  // human admin working through a queue, tight enough to blunt a
  // compromised admin session scripting mass mutations.
  ADMIN_PARTNER_MUTATION_BY_USER: { limit: 60, windowMs: HOUR },
  // Payout creation specifically gets its own, tighter budget — the one
  // action in this module that actually moves real money via a Stripe
  // Connect transfer (see CreatePartnerPayoutUseCase) — separate from the
  // broader admin-mutation budget above so a legitimate morning of
  // partner reviews/approvals never eats into the payout-specific budget,
  // and vice versa.
  PARTNER_PAYOUT_CREATE_BY_USER: { limit: 10, windowMs: HOUR },
} as const;

export type RateLimitPolicyName = keyof typeof RATE_LIMIT_POLICIES;
