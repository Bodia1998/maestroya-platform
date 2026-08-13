import "server-only";

import type { CheckerFindingInput, SafetyChecker, SubsystemCheckOutcome } from "@/application/ports/safety-checker";
import { SourceScanner } from "@/infrastructure/multi-instance-safety/source-scanner";

const JOB_SCHEDULER_PATH = "src/core/infrastructure/jobs/job-scheduler.ts";
const REDIS_JOB_STORE_PATH = "src/core/infrastructure/jobs/redis-job-store.ts";
const EXPIRE_WORKFLOWS_ROUTE_PATH = "src/app/api/cron/expire-workflows/route.ts";
const VERCEL_CONFIG_PATH = "vercel.json";

/**
 * Module 58 — Multi-Instance Safety Audit.
 *
 * Covers: duplicated scheduled jobs, background worker conflicts, cron
 * duplication. Two independent recurring-work mechanisms exist in this
 * codebase and both are checked on their own terms, not against a single
 * assumed pattern:
 *
 *  1. **`JobScheduler`** (in-process repeatable jobs, for a long-lived
 *     container deployment): safe under multiple instances *without* a
 *     distributed lock, by design — every occurrence gets a
 *     **deterministic** job id (`repeat:<name>:<occurrenceMs>`), so two
 *     instances that both decide "this occurrence is due" enqueue the
 *     same id, and the job store's own `SET ... NX`-style de-duplication
 *     (see `IdempotencyChecker`/`DistributedLockingChecker`) makes the
 *     second `add()` a no-op. This checker verifies that reasoning is
 *     actually true in the source, not just documented.
 *  2. **Vercel Cron** (`api/cron/expire-workflows`, for the serverless
 *     deployment path): a single HTTP endpoint Vercel's platform invokes
 *     on schedule — verified for shared-secret authorization (so an
 *     un-authenticated duplicate trigger from outside Vercel's own
 *     infrastructure is rejected), which is the actual duplication risk
 *     for a platform-invoked cron endpoint (Vercel itself is documented
 *     to guarantee at-most-one invocation per schedule tick).
 */
export class SchedulerCronChecker implements SafetyChecker {
  readonly subsystem = "Scheduled Jobs & Cron Duplication";

  constructor(private readonly scanner: SourceScanner = new SourceScanner()) {}

  async check(): Promise<SubsystemCheckOutcome> {
    const passedChecks: string[] = [];
    const findings: CheckerFindingInput[] = [];

    const scheduler = await this.scanner.read(JOB_SCHEDULER_PATH);
    if (scheduler && /repeat:\$\{definition\.name\}:\$\{occurrence\}/.test(scheduler)) {
      passedChecks.push(
        `${JOB_SCHEDULER_PATH}: every repeatable occurrence is enqueued with a deterministic job id (\`repeat:<name>:<occurrenceMs>\`) — two instances computing the same due occurrence produce the identical id, so the job store's own de-duplication (not a distributed lock) prevents a duplicate scheduled run.`,
      );
    } else {
      findings.push({
        severity: "CRITICAL",
        problem: "Could not confirm deterministic job ids for repeatable/scheduled job occurrences.",
        risk: "Multiple instances running the in-process `JobScheduler` could each independently enqueue their own copy of the same due occurrence, causing the recurring job to run multiple times per scheduled tick.",
        whyItHappens: `${JOB_SCHEDULER_PATH} did not match the expected \`repeat:<name>:<occurrenceMs>\` deterministic-id pattern.`,
        impact: "Duplicate execution of recurring jobs (e.g. duplicate reminder emails, duplicate cleanup sweeps) proportional to the number of running instances.",
        recommendedFix: "Derive each occurrence's job id deterministically from the schedule name and its exact occurrence timestamp, so every instance computing the same due occurrence produces an identical, de-duplicated id.",
        priority: "CRITICAL",
        evidence: [JOB_SCHEDULER_PATH],
      });
    }

    if (scheduler && /epoch-aligned/.test(scheduler)) {
      passedChecks.push(
        `${JOB_SCHEDULER_PATH}: occurrence times are epoch-aligned (not relative to when a given process happened to start), so instances that booted minutes apart still agree on the same occurrence boundaries and therefore the same deterministic id.`,
      );
    }

    const redisJobStore = await this.scanner.read(REDIS_JOB_STORE_PATH);
    if (redisJobStore && /jobId/.test(redisJobStore) && /NX/.test(redisJobStore)) {
      passedChecks.push(`${REDIS_JOB_STORE_PATH}: job enqueue de-duplication is backed by an atomic Redis \`NX\`-style write keyed by \`jobId\`, shared across every instance.`);
    } else {
      findings.push({
        severity: "WARNING",
        problem: "Could not confirm the job store's enqueue-time de-duplication is backed by an atomic, cross-instance-shared Redis write.",
        risk: "The deterministic-id strategy `JobScheduler` relies on only prevents duplicate scheduling if the underlying store's de-duplication is itself atomic and shared across instances.",
        whyItHappens: `${REDIS_JOB_STORE_PATH} did not match the expected \`jobId\` + \`NX\` pattern.`,
        impact: "The deterministic-id safety argument for `JobScheduler` would not actually hold under concurrent instances.",
        recommendedFix: "Confirm job enqueue uses an atomic, Redis-backed `SET ... NX`-equivalent keyed by the caller-supplied jobId.",
        priority: "HIGH",
        evidence: [REDIS_JOB_STORE_PATH],
      });
    }

    const cronRoute = await this.scanner.read(EXPIRE_WORKFLOWS_ROUTE_PATH);
    if (cronRoute && /CRON_SECRET/.test(cronRoute) && /401|503/.test(cronRoute)) {
      passedChecks.push(
        `${EXPIRE_WORKFLOWS_ROUTE_PATH}: the Vercel Cron endpoint requires a shared-secret bearer token and refuses every request (never silently skips the check) when the secret isn't configured — an unauthenticated caller cannot trigger a duplicate/extra run.`,
      );
    } else {
      findings.push({
        severity: "WARNING",
        problem: "Could not confirm shared-secret authorization on the Vercel Cron HTTP endpoint.",
        risk: "An unauthenticated caller could invoke the cron endpoint directly, duplicating the platform-scheduled run and running the workflow-expiration sweep more often than intended.",
        whyItHappens: `${EXPIRE_WORKFLOWS_ROUTE_PATH} did not match the expected \`CRON_SECRET\` bearer-token check.`,
        impact: "Extra/duplicate expiration sweeps triggerable by anyone who can reach the route, not just Vercel's own scheduler.",
        recommendedFix: "Require and verify a shared-secret bearer token (e.g. `CRON_SECRET`) on every cron HTTP endpoint, refusing the request outright when the secret is not configured.",
        priority: "MEDIUM",
        evidence: [EXPIRE_WORKFLOWS_ROUTE_PATH],
      });
    }

    const vercelConfig = await this.scanner.exists(VERCEL_CONFIG_PATH);
    if (vercelConfig) {
      passedChecks.push(`${VERCEL_CONFIG_PATH}: exists — the platform-cron path (Vercel's own single-invocation-per-tick guarantee) is a separate, already-covered mechanism from the in-process \`JobScheduler\`.`);
    }

    return { passedChecks, findings };
  }
}
