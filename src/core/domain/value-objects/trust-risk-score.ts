/**
 * Module 65 — Trust & Integrity System: the shared 0-100 bound both the
 * Trust Score and Risk Score obey. Kept as one tiny value-object module
 * (rather than two near-identical classes) because the only rule either
 * score enforces is "stay within [0, 100], integer, never NaN" — exactly
 * the kind of narrow, reusable invariant `roundToCents` (money.ts) models
 * for its own domain.
 */

export const MIN_SCORE = 0;
export const MAX_SCORE = 100;

/** Clamps an arbitrary integer into the valid [0, 100] score range. Never
 *  throws — every caller in this module computes a delta first and always
 *  wants "clamped to the boundary" rather than a thrown error, the same
 *  way `Math.min`/`Math.max` behave. */
export function clampScore(value: number): number {
  if (!Number.isFinite(value)) return MIN_SCORE;
  return Math.max(MIN_SCORE, Math.min(MAX_SCORE, Math.round(value)));
}

/** True when `value` is already a valid score (integer, within bounds) —
 *  used by repository/report-generator code that wants to assert an
 *  invariant rather than silently clamp. */
export function isValidScore(value: number): boolean {
  return Number.isInteger(value) && value >= MIN_SCORE && value <= MAX_SCORE;
}
