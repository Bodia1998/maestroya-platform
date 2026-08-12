import type { HealthStatus } from "@/domain/entities/health-status";

/**
 * Module 56 — Health Checks & Circuit Breakers.
 *
 * Every existing `collect*Health` function in this codebase (Modules
 * 44-55) already returns its own narrow status union — `"ok" | "error"`,
 * `"healthy" | "degraded" | "unavailable"`, `"ok" | "degraded" |
 * "disabled"`, etc. Rewriting any of those would be a business-logic
 * change this module is explicitly forbidden from making; instead, this
 * is the single normalization point that folds every one of them into
 * the module's three-state `HealthStatus`, so
 * `circuit-breaker-health-contributor.ts` can adapt any existing
 * collector without knowing its specific status vocabulary.
 *
 * Follows the precedent every one of those modules' own doc comments
 * already establishes: `"disabled"`/`"not_configured"`/`"bypassed"` is a
 * healthy, deliberate state, never a failure.
 */
const HEALTHY_VALUES = new Set(["ok", "healthy", "disabled", "not_configured", "bypassed"]);
const DEGRADED_VALUES = new Set(["degraded", "at_risk", "starting"]);
const UNHEALTHY_VALUES = new Set(["error", "unavailable", "unhealthy", "down"]);

export function normalizeHealthStatus(raw: string): HealthStatus {
  const value = raw.toLowerCase();
  if (HEALTHY_VALUES.has(value)) return "HEALTHY";
  if (DEGRADED_VALUES.has(value)) return "DEGRADED";
  if (UNHEALTHY_VALUES.has(value)) return "UNHEALTHY";
  // An unrecognized status string is treated conservatively as
  // DEGRADED — worth an operator's attention — rather than silently
  // reported as HEALTHY, which could hide a genuinely new failure mode
  // introduced by a future collector this normalizer doesn't know about
  // yet.
  return "DEGRADED";
}
