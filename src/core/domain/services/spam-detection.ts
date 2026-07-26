import { contentFingerprint } from "@/domain/services/security-key";

/**
 * Security & Anti-Abuse module (Module 24): deterministic, non-ML spam
 * heuristics for user-submitted free text (service-request descriptions,
 * chat messages, review comments). Two independent, composable checks:
 *
 *  1. "Is this the same content the same author just submitted" —
 *     `isDuplicateContent`, a fingerprint match against a short recent
 *     history the caller already has in hand (e.g. the last N message
 *     bodies in a conversation). This module never queries a database
 *     itself — callers (AntiAbuseService / a use case) supply whatever
 *     recent-history slice is relevant, keeping this pure and testable.
 *  2. "Is this author acting faster than a human plausibly would" —
 *     `isBelowMinimumInterval`, comparing two timestamps against a
 *     configured minimum gap.
 */

/** True when `candidate` fingerprints the same as any entry in `recent`
 *  (already-hashed or raw strings — pass raw text; this hashes it). Empty
 *  `recent` (no history yet, e.g. a brand-new conversation) never counts
 *  as a duplicate. */
export function isDuplicateContent(candidate: string, recent: string[]): boolean {
  if (recent.length === 0) return false;
  const candidateFingerprint = contentFingerprint(candidate);
  return recent.some((text) => contentFingerprint(text) === candidateFingerprint);
}

/**
 * True when `now` is sooner than `minIntervalMs` after `lastActionAt`.
 * `lastActionAt` of `null` (no prior action recorded) always returns
 * false — nothing to compare against yet.
 */
export function isBelowMinimumInterval(
  lastActionAt: Date | null,
  now: Date,
  minIntervalMs: number,
): boolean {
  if (!lastActionAt) return false;
  return now.getTime() - lastActionAt.getTime() < minIntervalMs;
}
