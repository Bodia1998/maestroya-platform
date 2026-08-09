import "server-only";

import { randomUUID } from "node:crypto";

import { ApplyRetentionPolicyUseCase } from "@/application/use-cases/backup/apply-retention-policy.use-case";
import { CreateBackupUseCase } from "@/application/use-cases/backup/create-backup.use-case";
import { GetBackupStatusUseCase } from "@/application/use-cases/backup/get-backup-status.use-case";
import { GetRecoveryReadinessUseCase } from "@/application/use-cases/recovery/get-recovery-readiness.use-case";
import { RestoreBackupUseCase } from "@/application/use-cases/recovery/restore-backup.use-case";
import { RunDisasterRecoveryUseCase } from "@/application/use-cases/recovery/run-disaster-recovery.use-case";
import { BackupPlanningService } from "@/application/services/backup/backup-planning-service";
import { BackupValidationService } from "@/application/services/backup/backup-validation-service";
import { IntegrityCheckService } from "@/application/services/backup/integrity-check-service";
import { RetentionPolicyService } from "@/application/services/backup/retention-policy-service";
import { DisasterRecoveryService } from "@/application/services/recovery/disaster-recovery-service";
import { RecoveryReadinessService } from "@/application/services/recovery/recovery-readiness-service";
import { RestoreValidationService } from "@/application/services/recovery/restore-validation-service";
import type { DatabaseBackupProvider } from "@/application/ports/database-backup-provider";
import type { StorageBackupProvider } from "@/application/ports/storage-backup-provider";
import type { BackupTarget } from "@/domain/entities/backup";
import { env } from "@/infrastructure/config/env";
import { resolveBackupConfig } from "@/infrastructure/backup/backup-config";
import { createBackupJobProcessor } from "@/infrastructure/backup/backup-job-processor";
import {
  BACKUP_DEAD_LETTER_QUEUE_NAME,
  BACKUP_QUEUE_NAME,
  backupRunJobIdempotencyKey,
  manualBackupRunJobId,
  type BackupRunJobData,
} from "@/infrastructure/backup/backup-jobs";
import type { BackupHealthReport } from "@/infrastructure/backup/backup-health";
import { collectBackupHealth, DISABLED_BACKUP_HEALTH } from "@/infrastructure/backup/backup-health";
import type { RecoveryHealthReport } from "@/infrastructure/backup/recovery-health";
import { collectRecoveryHealth, DISABLED_RECOVERY_HEALTH } from "@/infrastructure/backup/recovery-health";
import { PgDumpDatabaseBackupProvider } from "@/infrastructure/backup/pg-dump-database-backup-provider";
import { CloudinaryManifestStorageBackupProvider } from "@/infrastructure/backup/cloudinary-manifest-storage-backup-provider";
import { PrismaBackupRecordRepository } from "@/infrastructure/database/prisma/repositories/prisma-backup-record-repository";
import { PrismaRecoveryExecutionRepository } from "@/infrastructure/database/prisma/repositories/prisma-recovery-execution-repository";
import { cloudinary } from "@/infrastructure/storage/cloudinary/client";
import { createManagedQueue, getBackgroundJobRuntime, getJobObserver, jobDefaults } from "@/infrastructure/jobs/compose";
import { createJobIdempotencyStore } from "@/infrastructure/jobs/job-idempotency-store";
import { createJobStore } from "@/infrastructure/jobs/job-store-factory";
import type { QueueCounts } from "@/infrastructure/jobs/job-types";
import type { Queue } from "@/infrastructure/jobs/queue";
import type { DeadLetterJobData } from "@/infrastructure/jobs/worker";
import { Worker } from "@/infrastructure/jobs/worker";

/**
 * Module 54 — Backup & Disaster Recovery.
 *
 * Composition root — the same manual, no-DI-container convention as every
 * other `compose.ts` in this codebase, structurally closest to
 * `infrastructure/analytics/compose.ts`: repositories, two swappable
 * providers, a set of pure application services, a queue + worker built
 * on the shared Module 45 job runtime, a scheduled periodic trigger per
 * target, and two health reports consumed by `/api/health/ready`.
 *
 * ## `BACKUP_ENABLED=false` (the default)
 * Every read path (`getBackupStatus`, `getRecoveryReadiness`) still
 * works — status/readiness reporting must remain honest ("no backups
 * exist yet") even with the pipeline off, exactly like Module 50's
 * dashboard reads still work with `ANALYTICS_REFRESH_ENABLED=false`. Only
 * the queue/worker/scheduler are skipped.
 *
 * ## Why the queue, worker, and scheduler are lazy
 * Identical reasoning to `infrastructure/analytics/compose.ts`'s own doc
 * comment: Next.js imports modules during `next build` for analysis,
 * where constructing a worker/scheduler would be wrong, and every use
 * case above must keep working even in a process that never enables the
 * pipeline.
 */

const repository = new PrismaBackupRecordRepository();
const recoveryRepository = new PrismaRecoveryExecutionRepository();
const planning = new BackupPlanningService();
const validation = new BackupValidationService();
const integrity = new IntegrityCheckService();
const retention = new RetentionPolicyService();
const restoreValidation = new RestoreValidationService();
const readinessService = new RecoveryReadinessService();

let databaseProvider: DatabaseBackupProvider | null = null;
let storageProvider: StorageBackupProvider | null = null;
let backupQueue: Queue<BackupRunJobData> | null = null;
let deadLetterQueue: Queue<DeadLetterJobData> | null = null;
let worker: Worker<BackupRunJobData> | null = null;
let scheduled = false;

function enabled(): boolean {
  return env.BACKUP_ENABLED === "true";
}

export function getDatabaseBackupProvider(): DatabaseBackupProvider {
  if (!databaseProvider) {
    const config = resolveBackupConfig();
    databaseProvider = new PgDumpDatabaseBackupProvider({ connectionString: env.DATABASE_URL, storageDir: config.storageDir });
  }
  return databaseProvider;
}

export function getStorageBackupProvider(): StorageBackupProvider {
  if (!storageProvider) {
    const config = resolveBackupConfig();
    storageProvider = new CloudinaryManifestStorageBackupProvider({ api: cloudinary.api, storageDir: config.storageDir });
  }
  return storageProvider;
}

export function getCreateBackupUseCase(): CreateBackupUseCase {
  return new CreateBackupUseCase({
    repository,
    databaseProvider: getDatabaseBackupProvider(),
    storageProvider: getStorageBackupProvider(),
    planning,
    validation,
    integrity,
    generateId: randomUUID,
    now: () => new Date(),
  });
}

export function getApplyRetentionPolicyUseCase(): ApplyRetentionPolicyUseCase {
  return new ApplyRetentionPolicyUseCase({
    repository,
    databaseProvider: getDatabaseBackupProvider(),
    storageProvider: getStorageBackupProvider(),
    retention,
    now: () => new Date(),
  });
}

export function getBackupStatusUseCase(): GetBackupStatusUseCase {
  return new GetBackupStatusUseCase(repository);
}

export function getRestoreBackupUseCase(): RestoreBackupUseCase {
  return new RestoreBackupUseCase({
    repository,
    databaseProvider: getDatabaseBackupProvider(),
    storageProvider: getStorageBackupProvider(),
    restoreValidation,
    integrity,
    now: () => new Date(),
  });
}

export function getRunDisasterRecoveryUseCase(): RunDisasterRecoveryUseCase {
  return new RunDisasterRecoveryUseCase({
    service: new DisasterRecoveryService({ repository: recoveryRepository, generateId: randomUUID, now: () => new Date() }),
    restoreBackup: getRestoreBackupUseCase(),
    getBackupStatus: getBackupStatusUseCase(),
    integrity,
    databaseVerifier: getDatabaseBackupProvider(),
    storageVerifier: getStorageBackupProvider(),
  });
}

export function getRecoveryReadinessUseCase(): GetRecoveryReadinessUseCase {
  return new GetRecoveryReadinessUseCase({
    backupRepository: repository,
    recoveryRepository,
    readiness: readinessService,
    now: () => new Date(),
  });
}

/** The queue every scheduled/manual backup trigger enqueues into, plus — on first call — the worker that drains it. Mirrors `getAnalyticsRefreshQueue()`. */
function getBackupQueue(): Queue<BackupRunJobData> {
  if (!backupQueue) {
    backupQueue = createManagedQueue<BackupRunJobData>(BACKUP_QUEUE_NAME);
    deadLetterQueue = createManagedQueue<DeadLetterJobData>(BACKUP_DEAD_LETTER_QUEUE_NAME);
    const config = resolveBackupConfig();

    worker = new Worker<BackupRunJobData>(
      BACKUP_QUEUE_NAME,
      createBackupJobProcessor({
        createBackup: getCreateBackupUseCase(),
        applyRetention: getApplyRetentionPolicyUseCase(),
        retentionPolicy: config.retentionPolicy,
        schedulePolicy: config.schedulePolicy,
      }),
      {
        store: createJobStore(),
        concurrency: 1, // never run two backups for the same or different targets concurrently against one database connection pool.
        deadLetterQueue,
        observer: getJobObserver(),
        idempotency: {
          store: createJobIdempotencyStore(),
          keyFor: (job) => backupRunJobIdempotencyKey(job as never),
        },
      },
    );

    getBackgroundJobRuntime().registerWorker(worker);
  }
  return backupQueue;
}

/** Enqueues a manual "back up now" run. Returns immediately — the backup itself runs asynchronously on the worker. */
export async function triggerManualBackup(target: BackupTarget, reason: string): Promise<void> {
  const queue = getBackupQueue();
  await queue.add(
    "backup.run",
    { target, reason },
    { jobId: manualBackupRunJobId(target, new Date()), attempts: jobDefaults.maxAttempts, backoff: { type: "exponential", delay: 1000, jitter: 0.2 } },
  );
}

/**
 * Registers the two per-target scheduled backups against the shared
 * `JobScheduler`. Mirrors `registerScheduledAnalyticsRefresh()`: called
 * explicitly from `instrumentation.ts`, immediately before
 * `startBackgroundJobs()`, never as a side effect of import — see that
 * function's own doc comment for why.
 */
export function registerScheduledBackups(): void {
  if (scheduled || !enabled()) return;
  scheduled = true;

  const queue = getBackupQueue();
  const config = resolveBackupConfig();

  for (const target of ["DATABASE", "FILE_STORAGE"] as const) {
    getBackgroundJobRuntime().scheduler.register<BackupRunJobData>({
      name: `backup-${target.toLowerCase()}`,
      queue,
      jobName: "backup.run",
      data: { target, reason: "scheduled" },
      repeat: { pattern: config.scheduleCron },
      jobOptions: { attempts: jobDefaults.maxAttempts, backoff: { type: "exponential", delay: 1000, jitter: 0.2 } },
    });
  }
}

export async function getBackupHealth(): Promise<BackupHealthReport> {
  if (!enabled() && !backupQueue) return DISABLED_BACKUP_HEALTH;

  const targets: BackupTarget[] = ["DATABASE", "FILE_STORAGE"];
  const inputs = await Promise.all(
    targets.map(async (target) => ({
      target,
      latest: await repository.findLatestByTarget(target),
      latestCompleted: await repository.findLatestCompletedByTarget(target),
    })),
  );

  let queueCounts: QueueCounts | null = null;
  if (backupQueue) {
    try {
      queueCounts = await backupQueue.getCounts();
    } catch {
      queueCounts = null;
    }
  }

  return collectBackupHealth(inputs, queueCounts, new Date());
}

export async function getRecoveryHealth(): Promise<RecoveryHealthReport> {
  if (!enabled()) return DISABLED_RECOVERY_HEALTH;
  const readiness = await getRecoveryReadinessUseCase().execute();
  return collectRecoveryHealth(readiness);
}

/** Exposed for tests only — drops every singleton so the next call rebuilds. */
export const __testing = {
  reset(): void {
    databaseProvider = null;
    storageProvider = null;
    backupQueue = null;
    deadLetterQueue = null;
    worker = null;
    scheduled = false;
  },
  get worker(): Worker<BackupRunJobData> | null {
    return worker;
  },
};
