/**
 * Module 55 — Read Replicas.
 *
 * Pure replica-selection algorithms — given a list of *already filtered*
 * eligible candidates, which one serves the next read? Deliberately
 * knows nothing about health thresholds, staleness, or how a candidate
 * became eligible (that is `ReplicaHealth`, `domain/entities/read-replica.ts`,
 * and `ReplicaRouterService`, `application/services/database/`) — the
 * same separation `RetentionPolicyService` keeps from `RetentionPolicy`
 * itself: the *policy object* states a rule, a *service* applies it to a
 * collection.
 */

export interface ReplicaCandidate {
  readonly replicaId: string;
  /** `null` when no lag reading has been recorded yet — treated as "worst" by `LeastLagReplicaSelector`. */
  readonly lagMs: number | null;
}

export type ReplicaSelectionStrategyName = "ROUND_ROBIN" | "RANDOM" | "LEAST_LAG";

/**
 * One replica-selection algorithm. Implementations are pure functions of
 * their input except for `RoundRobinReplicaSelector`'s own internal
 * cursor, which is deliberately the *only* mutable state in this file —
 * "which replica is next" is inherently sequential.
 */
export interface ReplicaSelector {
  readonly name: ReplicaSelectionStrategyName;
  /** Returns `null` only when `candidates` is empty — every other case selects one. */
  select(candidates: readonly ReplicaCandidate[]): string | null;
}

/**
 * Cycles through candidates in the order given, one step per call —
 * the simplest fair-distribution strategy, and the default. The cursor
 * is keyed by the *candidate set's composition*, not a fixed index: a
 * replica flipping in/out of eligibility between calls does not skew the
 * rotation toward whichever replicas happen to remain, because the
 * index always advances relative to the list actually passed in.
 */
export class RoundRobinReplicaSelector implements ReplicaSelector {
  readonly name = "ROUND_ROBIN";
  private cursor = 0;

  select(candidates: readonly ReplicaCandidate[]): string | null {
    if (candidates.length === 0) return null;
    const index = this.cursor % candidates.length;
    this.cursor = (this.cursor + 1) % candidates.length;
    return candidates[index]?.replicaId ?? null;
  }
}

/** Picks uniformly at random. `random` is injectable so tests are deterministic. */
export class RandomReplicaSelector implements ReplicaSelector {
  readonly name = "RANDOM";

  constructor(private readonly random: () => number = Math.random) {}

  select(candidates: readonly ReplicaCandidate[]): string | null {
    if (candidates.length === 0) return null;
    const index = Math.min(Math.floor(this.random() * candidates.length), candidates.length - 1);
    return candidates[index]?.replicaId ?? null;
  }
}

/**
 * Picks the candidate with the lowest known replication lag — the
 * strongest read-freshness guarantee this module offers short of routing
 * to the primary outright. A candidate with `lagMs: null` (no reading
 * yet) sorts last, since an unmeasured replica is not known to be
 * fresher than a measured one. Ties (including "every candidate has
 * `null` lag") fall back to the first candidate in the given order —
 * deterministic, and equivalent to round-robin's first pick in the
 * all-unmeasured case.
 */
export class LeastLagReplicaSelector implements ReplicaSelector {
  readonly name = "LEAST_LAG";

  select(candidates: readonly ReplicaCandidate[]): string | null {
    if (candidates.length === 0) return null;

    const best = candidates.reduce((current, candidate) => (rank(candidate) < rank(current) ? candidate : current));
    return best.replicaId;
  }
}

function rank(candidate: ReplicaCandidate): number {
  return candidate.lagMs ?? Number.POSITIVE_INFINITY;
}

export function createReplicaSelector(name: ReplicaSelectionStrategyName, random?: () => number): ReplicaSelector {
  switch (name) {
    case "ROUND_ROBIN":
      return new RoundRobinReplicaSelector();
    case "RANDOM":
      return new RandomReplicaSelector(random);
    case "LEAST_LAG":
      return new LeastLagReplicaSelector();
  }
}
