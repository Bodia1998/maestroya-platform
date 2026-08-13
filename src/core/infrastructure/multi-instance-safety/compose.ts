import "server-only";

import { randomUUID } from "node:crypto";

import type { SafetyChecker } from "@/application/ports/safety-checker";
import { AuditScoringService } from "@/application/services/safety/audit-scoring-service";
import { RunMultiInstanceSafetyAuditUseCase } from "@/application/use-cases/safety/run-multi-instance-safety-audit.use-case";
import { CacheConsistencyChecker } from "@/infrastructure/multi-instance-safety/checkers/cache-consistency-checker";
import { DistributedLockingChecker } from "@/infrastructure/multi-instance-safety/checkers/distributed-locking-checker";
import { EventBusChecker } from "@/infrastructure/multi-instance-safety/checkers/event-bus-checker";
import { HealthScalingReadinessChecker } from "@/infrastructure/multi-instance-safety/checkers/health-scaling-readiness-checker";
import { IdempotencyChecker } from "@/infrastructure/multi-instance-safety/checkers/idempotency-checker";
import { RateLimitingChecker } from "@/infrastructure/multi-instance-safety/checkers/rate-limiting-checker";
import { ReadReplicaChecker } from "@/infrastructure/multi-instance-safety/checkers/read-replica-checker";
import { RealtimeSessionChecker } from "@/infrastructure/multi-instance-safety/checkers/realtime-session-checker";
import { SchedulerCronChecker } from "@/infrastructure/multi-instance-safety/checkers/scheduler-cron-checker";
import { StatelessAuthSessionChecker } from "@/infrastructure/multi-instance-safety/checkers/stateless-auth-session-checker";
import { TransactionConcurrencyChecker } from "@/infrastructure/multi-instance-safety/checkers/transaction-concurrency-checker";
import { UploadConsistencyChecker } from "@/infrastructure/multi-instance-safety/checkers/upload-consistency-checker";
import { SourceScanner } from "@/infrastructure/multi-instance-safety/source-scanner";

/**
 * Module 58 — Multi-Instance Safety Audit.
 *
 * Composition root — the same manual, no-DI-container convention as
 * every other `compose.ts` in this codebase. Structurally the simplest
 * of Modules 54-58: there is no persistence layer, no queue, worker, or
 * scheduler here at all — every `SafetyChecker` is pure, read-only static
 * analysis over the repository's own already-committed source tree (via
 * `SourceScanner`), and `RunMultiInstanceSafetyAuditUseCase` assembles
 * their output into a `MultiInstanceSafetyReport` entirely in memory. A
 * database connection, Redis client, or any other runtime dependency
 * would be actively wrong here: this module audits *other* modules'
 * multi-instance safety, and must remain fully functional even when
 * every one of those other modules' backing services (database, Redis)
 * is unreachable — the same "keep working with nothing configured"
 * discipline `infrastructure/performance/compose.ts` documents for
 * Module 57, taken one step further.
 *
 * Every checker shares a single `SourceScanner` instance (defaulting to
 * `process.cwd()` — the project root when invoked via `npm run
 * multi-instance-audit` or `vitest`) — memoized here so a single audit
 * run reads each file at most once across all checkers that happen to
 * reference the same path, and so tests can substitute a scanner rooted
 * at a fixture directory.
 */

let scanner: SourceScanner | null = null;

function getScanner(): SourceScanner {
  if (!scanner) {
    scanner = new SourceScanner();
  }
  return scanner;
}

function getCheckers(): readonly SafetyChecker[] {
  const s = getScanner();
  return [
    new StatelessAuthSessionChecker(s),
    new DistributedLockingChecker(s),
    new IdempotencyChecker(s),
    new EventBusChecker(s),
    new CacheConsistencyChecker(s),
    new RateLimitingChecker(s),
    new ReadReplicaChecker(s),
    new TransactionConcurrencyChecker(s),
    new SchedulerCronChecker(s),
    new RealtimeSessionChecker(s),
    new UploadConsistencyChecker(s),
    new HealthScalingReadinessChecker(s),
  ];
}

const scoring = new AuditScoringService();

export function getRunMultiInstanceSafetyAuditUseCase(): RunMultiInstanceSafetyAuditUseCase {
  return new RunMultiInstanceSafetyAuditUseCase({
    checkers: getCheckers(),
    scoring,
    generateId: randomUUID,
    now: () => new Date(),
  });
}

/** Exposed for tests only — drops the memoized scanner so the next call rebuilds it (e.g. rooted at a fixture directory). Mirrors every other `compose.ts`'s own `__testing.reset()`. */
export const __testing = {
  reset(): void {
    scanner = null;
  },
};
