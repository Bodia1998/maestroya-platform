import { ReferralCodeError } from "@/domain/errors/domain-error";

/**
 * Module 60 — Referral & Marketing Attribution Platform: pure format rules
 * for a `ReferralCode`. Lives here (not inline in a use case) so the same
 * rule can be reused by `CreateReferralCodeUseCase`, `TrackVisitUseCase`
 * (a visit may carry an unrecognized/malformed `?r=` code, which must be
 * rejected the same way everywhere), and unit tests — the same "pure
 * domain function throws a domain error, the use case decides what to do
 * with it" convention `professional-verification-rules.ts` establishes.
 *
 * Length bounds: 3–40 characters.
 *  - Lower bound (3): a 1–2 character code is too easy to guess/collide
 *    with (`"ab"`, `"1"`), and gives an analytics-report reader no
 *    meaningful label to skim.
 *  - Upper bound (40): long enough to be namespaced/human-readable (e.g.
 *    `telegram_valencia_q1_2026`) while still fitting comfortably in a URL
 *    query parameter (`?r=<code>`) without pushing a shared link past
 *    common URL-length practical limits, and short enough to render
 *    cleanly in a report table column.
 *
 * Character set: lowercase ASCII letters, digits, and underscore only.
 * Deliberately excludes uppercase (so `Telegram_Valencia` and
 * `telegram_valencia` can never silently become two different codes —
 * normalization happens once, here, not ad hoc at each call site),
 * spaces, and punctuation other than `_` (so the code is always safe to
 * drop into a URL query string with zero percent-encoding).
 */
export const REFERRAL_CODE_MIN_LENGTH = 3;
export const REFERRAL_CODE_MAX_LENGTH = 40;
const REFERRAL_CODE_PATTERN = /^[a-z0-9_]+$/;

/** Lowercases and trims — the one normalization every caller must apply
 *  before comparing/storing a code, so `"Telegram_Valencia"` and
 *  `"telegram_valencia "` resolve to the same code. */
export function normalizeReferralCode(raw: string): string {
  return raw.trim().toLowerCase();
}

/** Normalizes and validates `raw`, throwing `ReferralCodeError` for any
 *  violation. Returns the normalized code on success so callers never have
 *  to normalize twice. */
export function assertValidReferralCode(raw: string): string {
  const code = normalizeReferralCode(raw);
  if (code.length < REFERRAL_CODE_MIN_LENGTH || code.length > REFERRAL_CODE_MAX_LENGTH) {
    throw new ReferralCodeError(
      `Referral code must be between ${REFERRAL_CODE_MIN_LENGTH} and ${REFERRAL_CODE_MAX_LENGTH} characters (got ${code.length}).`,
    );
  }
  if (!REFERRAL_CODE_PATTERN.test(code)) {
    throw new ReferralCodeError(
      `Referral code "${raw}" is invalid — only lowercase letters, digits, and underscores are allowed.`,
    );
  }
  return code;
}

/** Non-throwing variant for call sites that only need a boolean (e.g.
 *  deciding whether an inbound `?r=` query param is even worth looking up,
 *  vs. treating the visit as having no referral code at all). */
export function isValidReferralCode(raw: string): boolean {
  try {
    assertValidReferralCode(raw);
    return true;
  } catch {
    return false;
  }
}
