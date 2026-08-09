import type { DisasterRecoveryPlan } from "@/domain/entities/disaster-recovery";

/**
 * Module 54 — Backup & Disaster Recovery.
 *
 * The platform's disaster-recovery plan catalog. Plans are defined in
 * code, not persisted as a database table — the same reasoning
 * `RateLimitPolicy`'s fixed policy set and Module 36's `TaxCalculator`
 * registry already establish for this codebase: a recovery *runbook* is a
 * reviewed, deployed engineering artifact (its steps and ordering are
 * exactly as load-bearing as code, and changing one deserves the same
 * code review a schema migration would), not operational data an admin UI
 * should be able to edit at runtime. What *is* persisted is the audit
 * trail of *executing* a plan (`RecoveryExecutionRepository`) — the part
 * that is genuinely a runtime fact, not a decision.
 *
 * Each plan's `steps` are ordered and each is marked `automated` or not:
 * `DisasterRecoveryService` runs the automated ones itself (backed by
 * this module's own use cases — restoring the latest backup, verifying
 * it) and records every non-automated step as requiring a human action,
 * without treating "needs a human" as a failure. See that service's own
 * doc comment for the execution semantics.
 */

export const DATABASE_OUTAGE_RECOVERY_PLAN: DisasterRecoveryPlan = {
  id: "database-outage-recovery",
  name: "Database outage recovery",
  description:
    "Recovery procedure for a total loss or corruption of the primary PostgreSQL database — restores from the most recent valid backup and verifies the restored data before declaring service restored.",
  rtoMinutes: 60,
  rpoMinutes: 1440,
  steps: [
    {
      id: "verify-latest-backup-integrity",
      order: 1,
      title: "Verify the latest database backup's integrity",
      description: "Recompute and compare the checksum of the most recent COMPLETED/VERIFIED database backup before attempting to restore it.",
      automated: true,
    },
    {
      id: "restore-database-from-latest-backup",
      order: 2,
      title: "Restore the database from the latest verified backup",
      description: "Run the database provider's restore operation against the verified backup artifact.",
      automated: true,
    },
    {
      id: "run-recovery-verification-queries",
      order: 3,
      title: "Run recovery verification queries",
      description: "Confirm the restored database is reachable and its core tables report plausible row counts.",
      automated: true,
    },
    {
      id: "notify-stakeholders",
      order: 4,
      title: "Notify stakeholders of the outage and recovery",
      description: "An operator communicates the incident timeline, RPO impact, and resolution to internal stakeholders and, if customer-facing, affected users.",
      automated: false,
    },
  ],
};

export const STORAGE_OUTAGE_RECOVERY_PLAN: DisasterRecoveryPlan = {
  id: "storage-outage-recovery",
  name: "File storage outage recovery",
  description:
    "Recovery procedure for loss of the file-storage resource manifest (Module 18/54) — since the platform's binary assets themselves are held by a third-party, durable, replicated provider (Cloudinary), this plan recovers the platform's own inventory of them, not the bytes.",
  rtoMinutes: 120,
  rpoMinutes: 1440,
  steps: [
    {
      id: "verify-latest-backup-integrity",
      order: 1,
      title: "Verify the latest storage manifest backup's integrity",
      description: "Recompute and compare the checksum of the most recent COMPLETED/VERIFIED storage-manifest backup.",
      automated: true,
    },
    {
      id: "restore-database-from-latest-backup",
      order: 2,
      title: "Restore the storage resource manifest",
      description: "Reload the verified manifest artifact so the platform's record of stored assets is back in place.",
      automated: true,
    },
    {
      id: "run-recovery-verification-queries",
      order: 3,
      title: "Spot-check restored manifest entries",
      description: "Confirm a sample of manifest entries still resolve at the third-party storage provider.",
      automated: true,
    },
    {
      id: "notify-stakeholders",
      order: 4,
      title: "Notify stakeholders of the outage and recovery",
      description: "An operator communicates the incident timeline and resolution to internal stakeholders.",
      automated: false,
    },
  ],
};

export const DISASTER_RECOVERY_PLAN_CATALOG: readonly DisasterRecoveryPlan[] = [
  DATABASE_OUTAGE_RECOVERY_PLAN,
  STORAGE_OUTAGE_RECOVERY_PLAN,
];

export function findDisasterRecoveryPlan(planId: string): DisasterRecoveryPlan | null {
  return DISASTER_RECOVERY_PLAN_CATALOG.find((plan) => plan.id === planId) ?? null;
}
