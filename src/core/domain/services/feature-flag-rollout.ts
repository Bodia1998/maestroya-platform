/**
 * Feature Flags module — deterministic percentage-rollout hashing.
 *
 * Pure, dependency-free (same convention as `geo-distance.ts`/
 * `bayesian-rating.ts`): given the same `(flagKey, salt, stableId)`, this
 * always returns the same bucket, so the same user always gets the same
 * rollout decision for a given flag across requests/processes — no
 * session affinity or sticky state required. Uses FNV-1a (32-bit), a
 * small, fast, well-distributed non-cryptographic hash — cryptographic
 * strength is irrelevant here (nothing security-sensitive depends on this
 * being unpredictable; targeting/deny-lists exist for that), only uniform
 * distribution across buckets does.
 */

const FNV_OFFSET_BASIS = 0x811c9dc5;
const FNV_PRIME = 0x01000193;
const BUCKET_COUNT = 10_000;

/** FNV-1a 32-bit hash of `input`, as an unsigned 32-bit integer. */
function fnv1a(input: string): number {
  let hash = FNV_OFFSET_BASIS;
  for (let i = 0; i < input.length; i += 1) {
    hash ^= input.charCodeAt(i);
    // Multiply by the FNV prime using Math.imul to get correct 32-bit
    // wraparound behaviour (plain `*` would lose precision beyond 2^53).
    hash = Math.imul(hash, FNV_PRIME);
  }
  // Force unsigned 32-bit representation.
  return hash >>> 0;
}

/**
 * Buckets `stableId` into `[0, BUCKET_COUNT)` for a given `(flagKey, salt)`
 * pair. Two-hundredths-of-a-percent resolution (`BUCKET_COUNT = 10_000`)
 * rather than 100 buckets, so a 0.01% rollout step is representable —
 * meaningfully finer-grained than "1 of 100 users" for a platform at any
 * real scale, at negligible extra cost.
 *
 * `salt` distinguishes independent hash spaces derived from the same
 * `stableId` — the rollout-percentage decision and the variant-selection
 * decision (see `pickVariant` below) must not correlate with each other,
 * or a user's rollout inclusion would leak into which variant they land
 * in and vice versa.
 */
export function hashToBucket(flagKey: string, salt: string, stableId: string): number {
  const hash = fnv1a(`${flagKey}:${salt}:${stableId}`);
  return hash % BUCKET_COUNT;
}

/**
 * Whether `stableId` falls inside a `percentage` (0-100, inclusive)
 * rollout for `flagKey`. Deterministic: same inputs always return the
 * same answer. `percentage <= 0` never includes anyone (even bucket 0 is
 * excluded, matching the intuitive "0% means off"); `percentage >= 100`
 * always includes everyone.
 */
export function isInRolloutPercentage(flagKey: string, stableId: string, percentage: number): boolean {
  if (percentage <= 0) return false;
  if (percentage >= 100) return true;
  const bucket = hashToBucket(flagKey, "rollout", stableId);
  const threshold = (percentage / 100) * BUCKET_COUNT;
  return bucket < threshold;
}

export interface WeightedVariant {
  readonly name: string;
  readonly weight: number;
}

/**
 * Deterministically picks one of `variants` for `stableId`, weighted by
 * each variant's `weight` (normalized here — they don't need to sum to
 * 100). Returns `undefined` for an empty list or when every weight is
 * zero/negative (a caller error, not a runtime failure — the evaluator
 * treats that as "no variant", not a thrown error, keeping evaluation
 * fail-closed).
 */
export function pickVariant(flagKey: string, stableId: string, variants: readonly WeightedVariant[]): string | undefined {
  const positive = variants.filter((v) => v.weight > 0);
  const totalWeight = positive.reduce((sum, v) => sum + v.weight, 0);
  if (positive.length === 0 || totalWeight <= 0) return undefined;

  const bucket = hashToBucket(flagKey, "variant", stableId);
  const target = (bucket / BUCKET_COUNT) * totalWeight;

  let cumulative = 0;
  for (const variant of positive) {
    cumulative += variant.weight;
    if (target < cumulative) return variant.name;
  }
  // Floating point edge case (target === totalWeight exactly): fall back
  // to the last positive-weight variant rather than undefined.
  return positive[positive.length - 1]?.name;
}

/** Exposed for tests only. */
export const __testing = { fnv1a, BUCKET_COUNT };
