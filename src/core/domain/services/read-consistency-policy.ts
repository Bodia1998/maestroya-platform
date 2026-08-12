/**
 * Module 55 — Read Replicas.
 *
 * The read-consistency decision: given how strict a caller needs its
 * data to be, is a replica (which may lag the primary by some amount)
 * an acceptable source for this read at all? Pure and total — no I/O,
 * no knowledge of *which* replica, only the rule.
 *
 *  - `STRONG`   — must observe every prior write. Never eligible for a
 *    replica; the caller needs the primary. The right choice immediately
 *    after a write the same request must then read back (the classic
 *    replication-lag read-your-own-writes hazard).
 *  - `EVENTUAL` — the default. Any replica is acceptable regardless of
 *    lag — the caller has already accepted that replicas trail the
 *    primary by some (usually sub-second) amount, which is the entire
 *    point of using one.
 *  - `BOUNDED_STALENESS` — a replica is acceptable only if its most
 *    recently observed lag is within `maxStalenessMs`. The middle
 *    ground: still offloads the primary, but caps how stale an answer
 *    the caller is willing to accept.
 *
 * `permitsReplicaRead` never inspects a *specific* replica's live
 * state — `ReplicaRouterService` supplies the one candidate lag reading
 * (or `null`) relevant to the decision being made; this function only
 * states the rule those numbers are checked against.
 */
export type ReadConsistencyLevel = "STRONG" | "EVENTUAL" | "BOUNDED_STALENESS";

export interface ReadConsistencyPolicy {
  readonly level: ReadConsistencyLevel;
  /** Only meaningful for `level === "BOUNDED_STALENESS"`. */
  readonly maxStalenessMs: number;
}

/**
 * Whether a replica may serve a read at all under the given policy —
 * independent of which specific replica, or whether one is even healthy;
 * `ReplicaRouterService` combines this with replica health/eligibility
 * separately. `lagMs: null` (no lag reading yet for the replica under
 * consideration) is treated as *not* satisfying `BOUNDED_STALENESS` —
 * an unmeasured replica cannot be shown to be within any bound.
 */
export function permitsReplicaRead(policy: ReadConsistencyPolicy, lagMs: number | null): boolean {
  switch (policy.level) {
    case "STRONG":
      return false;
    case "EVENTUAL":
      return true;
    case "BOUNDED_STALENESS":
      return lagMs !== null && lagMs <= policy.maxStalenessMs;
  }
}
