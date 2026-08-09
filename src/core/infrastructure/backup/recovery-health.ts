import type { RecoveryReadinessReport } from "@/application/services/recovery/recovery-readiness-service";

/**
 * Module 54 — Backup & Disaster Recovery.
 *
 * The shape `/api/health/ready` reports under `checks.disasterRecovery` —
 * a thin, non-throwing wrapper over `GetRecoveryReadinessUseCase`'s own
 * `RecoveryReadinessReport`, joining the route's "operational visibility
 * only" category for the identical reason `checks.backup` does: a
 * disaster-recovery plan being at-risk or not-ready is a real, worth-
 * fixing gap in the platform's recovery posture, but it is not itself a
 * reason this instance cannot serve HTTP traffic right now — the
 * scenario it describes is *hypothetical* ("if disaster struck, could we
 * recover fast enough"), never a present-tense outage.
 */
export type RecoveryHealthStatus = "ok" | "degraded" | "at_risk" | "disabled";

export interface RecoveryHealthReport {
  status: RecoveryHealthStatus;
  readiness: RecoveryReadinessReport | null;
}

export const DISABLED_RECOVERY_HEALTH: RecoveryHealthReport = { status: "disabled", readiness: null };

export function collectRecoveryHealth(readiness: RecoveryReadinessReport): RecoveryHealthReport {
  const status: RecoveryHealthStatus = readiness.status === "ready" ? "ok" : readiness.status === "at_risk" ? "at_risk" : "degraded";
  return { status, readiness };
}
