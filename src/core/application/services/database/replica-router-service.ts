import { ReplicaHealth, type ReplicaHealthSnapshot, type ReplicaHealthThresholds, ReplicationLag } from "@/domain/entities/read-replica";
import { permitsReplicaRead, type ReadConsistencyPolicy } from "@/domain/services/read-consistency-policy";
import type { ReplicaCandidate, ReplicaSelector } from "@/domain/services/replica-selector";

/**
 * Module 55 — Read Replicas.
 *
 * The routing decision engine — "read replica routing", "automatic
 * fallback to primary", "read consistency strategy" and "replica
 * selection strategy" all meet here, and only here. Pure orchestration:
 * this class issues no query and opens no connection of its own. It is
 * fed replica identities once at construction, fed real outcomes
 * (`recordSuccess`/`recordFailure`) by whoever actually executes a query
 * — the Prisma `$extends` hook in
 * `infrastructure/database/prisma/read-replica-extension.ts` for organic
 * traffic, `ReplicaHealthMonitorService` for active pings — and asked
 * for a decision (`route`) by that same hook before every eligible read.
 *
 * This is the same role `CacheManager`
 * (`application/services/cache/cache-manager.ts`) plays for Module 46:
 * a pure application-layer service sitting between a `Port` (there,
 * `CacheProvider`; here, nothing — see below) and its infrastructure
 * caller, independent of Prisma, Redis, or any concrete backend.
 *
 * ## Why this class has no port dependency of its own
 * Unlike `CacheManager`, `ReplicaRouterService` does not depend on
 * `ReplicaHealthChecker` — it never pings anything itself. Health
 * signals arrive as plain data through `recordSuccess`/`recordFailure`,
 * from *two* independent sources (organic query outcomes and the active
 * monitor), and this class's only job is to fold whichever arrives first
 * into its per-replica `ReplicaHealth` state machine and answer `route()`
 * from the result. That is what makes a replica that fails a live query
 * ineligible immediately, without waiting for the next active health
 * check to notice.
 *
 * ## Fallback, precisely
 * `route()` always returns a decision — it is a query, not a command,
 * and never throws. "Fallback to primary" is therefore *baked into every
 * call*, not a separate error-handling branch: a `STRONG` consistency
 * requirement, an empty replica set, or a moment where every replica is
 * `DEGRADED`/`UNHEALTHY`/`UNKNOWN`/stale all resolve to
 * `{ target: "primary" }` through the same code path. The
 * `$allOperations` hook additionally falls back *mid-flight* — if a
 * chosen replica's actual query throws, it retries once against the
 * primary and calls `recordFailure` — which this class enables by making
 * that replica ineligible for the *next* decision, but does not itself
 * implement (a router cannot retry a query it never issued).
 */

export type DatabaseOperationKind = "read" | "write";

export interface ReplicaDescriptor {
  readonly replicaId: string;
}

export type RouteDecision =
  | { readonly target: "primary"; readonly reason: string }
  | { readonly target: "replica"; readonly replicaId: string; readonly reason: string };

export interface ReplicaRoutingSnapshot {
  readonly enabled: boolean;
  readonly strategy: string;
  readonly replicas: readonly ReplicaHealthSnapshot[];
}

export interface ReplicaRouterServiceOptions {
  readonly replicas: readonly ReplicaDescriptor[];
  readonly selector: ReplicaSelector;
  readonly thresholds: ReplicaHealthThresholds;
  readonly defaultConsistency: ReadConsistencyPolicy;
  /**
   * A replica's last health signal older than this is treated as
   * ineligible ("stale", `ReplicaHealth.isEligible`'s own semantics) —
   * protects against routing to a replica whose failure went unnoticed
   * because no query happened to touch it and the active monitor hasn't
   * run recently enough. `null` disables the check entirely (every
   * signal, however old, remains trusted) — not used in production
   * configuration, but is what makes this class testable without a
   * clock dependency in tests that don't care about staleness.
   */
  readonly maxHealthAgeMs: number | null;
  readonly now?: () => Date;
}

export class ReplicaRouterService {
  private readonly health = new Map<string, ReplicaHealth>();
  private readonly selector: ReplicaSelector;
  private readonly thresholds: ReplicaHealthThresholds;
  private readonly defaultConsistency: ReadConsistencyPolicy;
  private readonly maxHealthAgeMs: number | null;
  private readonly now: () => Date;

  constructor(options: ReplicaRouterServiceOptions) {
    this.selector = options.selector;
    this.thresholds = options.thresholds;
    this.defaultConsistency = options.defaultConsistency;
    this.maxHealthAgeMs = options.maxHealthAgeMs;
    this.now = options.now ?? (() => new Date());

    for (const replica of options.replicas) {
      this.health.set(replica.replicaId, new ReplicaHealth(replica.replicaId, options.thresholds));
    }
  }

  get replicaIds(): readonly string[] {
    return [...this.health.keys()];
  }

  get isEnabled(): boolean {
    return this.health.size > 0;
  }

  /**
   * The routing decision for one operation. `consistency` overrides the
   * module-wide default for this specific call — the mechanism
   * `infrastructure/database/read-consistency-context.ts`'s
   * `withReadConsistency()` uses to request `STRONG` consistency for a
   * read that must observe a write the same request just made.
   */
  route(kind: DatabaseOperationKind, consistency?: ReadConsistencyPolicy): RouteDecision {
    if (kind === "write") {
      return { target: "primary", reason: "write operations always target the primary." };
    }

    if (this.health.size === 0) {
      return { target: "primary", reason: "no read replicas are configured." };
    }

    const policy = consistency ?? this.defaultConsistency;
    if (policy.level === "STRONG") {
      return { target: "primary", reason: "STRONG read consistency requires the primary." };
    }

    const now = this.now();
    const candidates: ReplicaCandidate[] = [];
    for (const replica of this.health.values()) {
      if (!replica.isEligible(now, this.maxHealthAgeMs)) continue;
      if (!permitsReplicaRead(policy, replica.lastLagMs)) continue;
      candidates.push({ replicaId: replica.replicaId, lagMs: replica.lastLagMs });
    }

    if (candidates.length === 0) {
      return { target: "primary", reason: "no eligible replica currently satisfies health/consistency requirements." };
    }

    const selected = this.selector.select(candidates);
    if (selected === null) {
      return { target: "primary", reason: "replica selection strategy returned no candidate." };
    }

    return { target: "replica", replicaId: selected, reason: `selected by ${this.selector.name} strategy.` };
  }

  /**
   * Feeds a successful query/ping outcome into the named replica's
   * health state. Unknown ids are ignored — never throws.
   *
   * `replicationLagMs` mirrors `ReplicaHealth.recordSuccess`'s own
   * three-state `lag` parameter: omit it (or pass `undefined`) for an
   * organic query success that carries no lag information — the
   * previously recorded lag reading is preserved — pass a number or
   * `null` for an actual measurement (`ReplicaHealthMonitorService`'s
   * active pings always pass one of these).
   */
  recordSuccess(replicaId: string, latencyMs: number, replicationLagMs?: number | null): void {
    const replica = this.health.get(replicaId);
    if (!replica) return;
    const lag = replicationLagMs === undefined ? undefined : replicationLagMs === null ? null : new ReplicationLag(replicationLagMs);
    replica.recordSuccess(latencyMs, lag, this.now());
  }

  /** Feeds a failed query/ping outcome into the named replica's health state. Unknown ids are ignored — never throws. */
  recordFailure(replicaId: string, error: string): void {
    const replica = this.health.get(replicaId);
    if (!replica) return;
    replica.recordFailure(error, this.now());
  }

  /** The current health of every configured replica — consumed by `read-replica-health.ts` for `/api/health/ready`. */
  snapshot(): ReplicaRoutingSnapshot {
    return {
      enabled: this.isEnabled,
      strategy: this.selector.name,
      replicas: [...this.health.values()].map((replica) => replica.toSnapshot()),
    };
  }

  /** Exposed for tests: threshold/consistency values this router was constructed with. */
  get configuredThresholds(): ReplicaHealthThresholds {
    return this.thresholds;
  }
}
