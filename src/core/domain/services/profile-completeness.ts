/**
 * Search & Ranking module (Module 19) — profile completeness signal.
 *
 * A simple, explainable, deterministic proxy for "how filled-out is this
 * profile" using only fields that already exist on ProfessionalProfile /
 * CompanyProfile — no new profile fields are introduced solely for ranking.
 * Verification is deliberately excluded here even though it is a form of
 * "profile trust": it already has its own, larger weight in the ranking
 * engine (`verificationScore`), so including it here too would double-count
 * the same signal under two names.
 */
export interface ProfileCompletenessSignals {
  hasHeadlineOrDescription: boolean;
  hasBioOrDescription: boolean;
  hasCategories: boolean;
  hasLocation: boolean;
  hasAvatarOrLogo: boolean;
  hasContactInfo: boolean;
  hasPortfolio: boolean;
}

const SIGNAL_KEYS: (keyof ProfileCompletenessSignals)[] = [
  "hasHeadlineOrDescription",
  "hasBioOrDescription",
  "hasCategories",
  "hasLocation",
  "hasAvatarOrLogo",
  "hasContactInfo",
  "hasPortfolio",
];

/**
 * Returns a score in [0, 1] — the fraction of tracked signals present.
 * Deterministic: the same signals always produce the same score, and the
 * result is independent of object key order.
 */
export function computeProfileCompleteness(signals: ProfileCompletenessSignals): number {
  const total = SIGNAL_KEYS.length;
  const present = SIGNAL_KEYS.reduce((count, key) => count + (signals[key] ? 1 : 0), 0);
  return present / total;
}
