import "server-only";

import type { LoadTestExecutionOutcome, LoadTestExecutor, RawExecutionSample } from "@/application/ports/load-test-executor";
import type { PerformanceScenario, ScenarioCategory } from "@/domain/entities/performance-scenario";
import { estimateResourceUsage } from "@/infrastructure/performance/metrics-collector";

/**
 * Module 57 — Load Testing & Capacity Planning.
 *
 * `BenchmarkRunner` is the only `LoadTestExecutor` implementation this
 * module ships — a deterministic, **in-process** workload simulator. It
 * never makes a real network call, never touches the real database, and
 * never talks to Stripe: this module's whole purpose is capacity
 * *planning*, not external benchmarking (see the module's own top-level
 * doc comment / `docs/MODULE_57_LOAD_TESTING_AND_CAPACITY_PLANNING.md`).
 * `STRIPE_PAYMENT_FLOW` in particular simulates the *shape and timing* of
 * a payment-intent create → confirm → webhook round trip (bimodal
 * latency: a fast path plus an occasional slower "waiting on the
 * gateway" tail), never a real Stripe API call — this is a mock
 * implementation by design, not a stand-in that happens to be unfinished.
 *
 * ## Determinism
 * Every random decision (latency jitter, failure/timeout/retry rolls)
 * comes from a seeded PRNG constructed fresh per `execute()` call —
 * `mulberry32`, a small, fast, well-known 32-bit generator, implemented
 * inline rather than pulling in a dependency (this codebase's convention:
 * see `LatencyStatistics`'s own doc comment on hand-rolled math). The same
 * `(scenario, seed)` pair always produces the same samples, so a capacity
 * report is exactly reproducible for review.
 */
const MAX_SIMULATED_SAMPLES = 3000;

interface LatencyProfile {
  /** Typical latency at low concurrency, milliseconds. */
  baseMs: number;
  /** Standard deviation of the (approximately) normal jitter around `baseMs`. */
  jitterMs: number;
  /** How much slower a sample gets per additional virtual user beyond the first — models queueing/contention growing with concurrency, independent of `CapacityPlanningService`'s own tier extrapolation (this is *within* the single simulated run). */
  concurrencyPenaltyMsPerUser: number;
  /** Probability (0..1) a sample fails outright. */
  failureProbability: number;
  /** Probability (0..1), independent of failure, a sample times out (implies failure). */
  timeoutProbability: number;
  /** Probability (0..1), independent of failure, a sample required a retry. */
  retryProbability: number;
  /** `STRIPE_PAYMENT_FLOW`-only: probability a sample falls into the slow "gateway wait" tail, and the extra latency (ms) added when it does. */
  slowTail?: { probability: number; extraMs: number };
}

const LATENCY_PROFILES: Record<ScenarioCategory, LatencyProfile> = {
  USER_REGISTRATION: { baseMs: 180, jitterMs: 40, concurrencyPenaltyMsPerUser: 0.3, failureProbability: 0.01, timeoutProbability: 0.002, retryProbability: 0.01 },
  AUTHENTICATION: { baseMs: 90, jitterMs: 20, concurrencyPenaltyMsPerUser: 0.1, failureProbability: 0.005, timeoutProbability: 0.001, retryProbability: 0.005 },
  PASSWORD_RESET: { baseMs: 150, jitterMs: 35, concurrencyPenaltyMsPerUser: 0.2, failureProbability: 0.01, timeoutProbability: 0.002, retryProbability: 0.01 },
  SEARCH: { baseMs: 60, jitterMs: 15, concurrencyPenaltyMsPerUser: 0.05, failureProbability: 0.003, timeoutProbability: 0.001, retryProbability: 0.003 },
  CREATE_SERVICE_REQUEST: { baseMs: 220, jitterMs: 50, concurrencyPenaltyMsPerUser: 0.35, failureProbability: 0.015, timeoutProbability: 0.003, retryProbability: 0.015 },
  BROWSE_PROFESSIONALS: { baseMs: 40, jitterMs: 10, concurrencyPenaltyMsPerUser: 0.03, failureProbability: 0.002, timeoutProbability: 0.0005, retryProbability: 0.002 },
  SUBMIT_QUOTE: { baseMs: 200, jitterMs: 45, concurrencyPenaltyMsPerUser: 0.3, failureProbability: 0.012, timeoutProbability: 0.002, retryProbability: 0.012 },
  ACCEPT_QUOTE: { baseMs: 240, jitterMs: 55, concurrencyPenaltyMsPerUser: 0.4, failureProbability: 0.015, timeoutProbability: 0.003, retryProbability: 0.015 },
  BOOKING: { baseMs: 210, jitterMs: 45, concurrencyPenaltyMsPerUser: 0.32, failureProbability: 0.012, timeoutProbability: 0.002, retryProbability: 0.012 },
  MESSAGING: { baseMs: 70, jitterMs: 20, concurrencyPenaltyMsPerUser: 0.08, failureProbability: 0.006, timeoutProbability: 0.001, retryProbability: 0.006 },
  NOTIFICATIONS: { baseMs: 100, jitterMs: 25, concurrencyPenaltyMsPerUser: 0.1, failureProbability: 0.008, timeoutProbability: 0.002, retryProbability: 0.008 },
  STRIPE_PAYMENT_FLOW: {
    baseMs: 260,
    jitterMs: 60,
    concurrencyPenaltyMsPerUser: 0.4,
    failureProbability: 0.02,
    timeoutProbability: 0.004,
    retryProbability: 0.02,
    slowTail: { probability: 0.12, extraMs: 900 },
  },
  ADMIN_DASHBOARD: { baseMs: 400, jitterMs: 90, concurrencyPenaltyMsPerUser: 1.2, failureProbability: 0.01, timeoutProbability: 0.003, retryProbability: 0.005 },
  CONCURRENT_API_TRAFFIC: { baseMs: 50, jitterMs: 15, concurrencyPenaltyMsPerUser: 0.06, failureProbability: 0.01, timeoutProbability: 0.003, retryProbability: 0.01 },
  DATABASE_INTENSIVE: { baseMs: 320, jitterMs: 80, concurrencyPenaltyMsPerUser: 0.9, failureProbability: 0.02, timeoutProbability: 0.006, retryProbability: 0.02 },
  MIXED_WORKLOAD: { baseMs: 150, jitterMs: 45, concurrencyPenaltyMsPerUser: 0.25, failureProbability: 0.012, timeoutProbability: 0.003, retryProbability: 0.012 },
};

export class BenchmarkRunner implements LoadTestExecutor {
  async execute(scenario: PerformanceScenario, seed: number): Promise<LoadTestExecutionOutcome> {
    const profile = LATENCY_PROFILES[scenario.category];
    const rng = mulberry32(seed);
    const virtualUsers = scenario.workloadProfile.virtualUsers;

    const sampleCount = Math.min(MAX_SIMULATED_SAMPLES, scenario.workloadProfile.estimatedTotalRequests());
    const samples: RawExecutionSample[] = new Array(sampleCount);

    for (let i = 0; i < sampleCount; i += 1) {
      samples[i] = sampleOne(profile, virtualUsers, rng);
    }

    const failedCount = samples.filter((s) => !s.succeeded).length;
    const errorRate = sampleCount === 0 ? 0 : failedCount / sampleCount;

    return {
      samples,
      resourceEstimate: estimateResourceUsage({ category: scenario.category, virtualUsers, errorRate }),
    };
  }
}

function sampleOne(profile: LatencyProfile, virtualUsers: number, rng: () => number): RawExecutionSample {
  const concurrencyPenalty = Math.max(0, virtualUsers - 1) * profile.concurrencyPenaltyMsPerUser;
  const jitter = gaussian(rng) * profile.jitterMs;
  let latencyMs = Math.max(1, profile.baseMs + concurrencyPenalty + jitter);

  if (profile.slowTail && rng() < profile.slowTail.probability) {
    latencyMs += profile.slowTail.extraMs;
  }

  const timedOut = rng() < profile.timeoutProbability;
  const failedOutright = rng() < profile.failureProbability;
  const succeeded = !timedOut && !failedOutright;
  const retried = rng() < profile.retryProbability;

  if (timedOut) {
    // A timeout is, definitionally, the slowest possible outcome for a
    // sample — model it as hitting a fixed high-latency ceiling rather
    // than the normal jittered latency computed above.
    latencyMs = Math.max(latencyMs, profile.baseMs * 10);
  }

  return { latencyMs, succeeded, timedOut, retried };
}

/** Approximately standard-normal (mean 0, stddev 1) via the Box-Muller transform, driven by the injected seeded `rng` — never `Math.random()`. */
function gaussian(rng: () => number): number {
  const u1 = Math.max(rng(), Number.EPSILON);
  const u2 = rng();
  return Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * u2);
}

/**
 * mulberry32 — a small, fast, deterministic 32-bit PRNG. Public-domain
 * algorithm (Tommy Ettinger), chosen for exactly the properties this
 * module needs: seedable, fast, good-enough statistical quality for
 * workload simulation (not cryptographic use), and small enough to
 * implement inline rather than adding a dependency.
 */
export function mulberry32(seed: number): () => number {
  let state = seed >>> 0;
  return function next(): number {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
