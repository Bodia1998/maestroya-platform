import { nextCronOccurrence, parseCronExpression } from "@/infrastructure/jobs/cron-expression";
import type { JobOptions, RepeatOptions } from "@/infrastructure/jobs/job-types";
import type { Queue } from "@/infrastructure/jobs/queue";

export interface ScheduleDefinition<TData = unknown> {
  /** Stable identifier for this schedule — part of every enqueued job's id. */
  name: string;
  queue: Queue<TData>;
  jobName: string;
  data: TData;
  repeat: RepeatOptions;
  /** Retry/backoff options applied to each enqueued occurrence. */
  jobOptions?: Omit<JobOptions, "jobId" | "delay" | "repeat">;
}

interface ScheduleState {
  definition: ScheduleDefinition<never>;
  /** Epoch ms of the most recent occurrence already enqueued, or the registration time. */
  cursor: number;
  runs: number;
}

/**
 * Module 45 — Background Jobs (Roadmap Module 12).
 *
 * Repeatable/scheduled jobs — BullMQ's `repeat` option, supporting both
 * `{ every: ms }` and `{ pattern: "<5-field cron>" }` (evaluated in UTC;
 * see `cron-expression.ts`).
 *
 * ## Safe under multiple instances, without a leader election
 * Every occurrence is enqueued with a **deterministic** job id derived
 * from the schedule name and the occurrence's exact epoch timestamp:
 * `repeat:<name>:<occurrenceMs>`. Two app instances that both wake up and
 * compute "the 03:00 run is due" produce the *same* id, and the
 * `JobStore`'s `add()` de-duplication means exactly one job is created —
 * the second `add()` returns `null` and is a no-op. Occurrence times are
 * epoch-aligned for `every` (`ceil(after / every) * every`) rather than
 * relative to when a given process happened to start, so instances agree
 * on the boundaries even if they booted minutes apart.
 *
 * This is why there is no distributed lock here, even though
 * `DistributedLock` exists in this codebase (Module 44): deterministic
 * ids solve the duplicate-scheduling problem more cheaply and with no
 * lock to time out or leak.
 *
 * ## Relationship to the existing Vercel cron
 * `vercel.json`'s `crons` entry and `api/cron/expire-workflows/route.ts`
 * are deliberately left exactly as they are and remain the production
 * path for workflow expiration. This scheduler is **additive
 * capability**: on Vercel, instances are not long-lived, so an
 * in-process scheduler is the wrong tool and platform cron is right; on
 * a long-lived container deployment (the `Dockerfile`/
 * `docker-compose.prod.yml` path) there is no platform cron, and this is
 * how a recurring job gets scheduled. Migrating expire-workflows is
 * shown as a worked example in the module doc but is not performed —
 * breaking a working production sweep to demonstrate a new mechanism
 * would be a bad trade.
 */
export class JobScheduler {
  private readonly schedules = new Map<string, ScheduleState>();
  private readonly now: () => number;
  private readonly tickIntervalMs: number;
  private timer: ReturnType<typeof setInterval> | null = null;

  constructor(options: { now?: () => number; tickIntervalMs?: number } = {}) {
    this.now = options.now ?? Date.now;
    this.tickIntervalMs = Math.max(1, options.tickIntervalMs ?? 30_000);
  }

  register<TData>(definition: ScheduleDefinition<TData>): void {
    if (this.schedules.has(definition.name)) {
      throw new Error(`A schedule named ${JSON.stringify(definition.name)} is already registered.`);
    }
    validateRepeat(definition.repeat, definition.name);

    this.schedules.set(definition.name, {
      definition: definition as unknown as ScheduleDefinition<never>,
      cursor: this.now(),
      runs: 0,
    });
  }

  start(): void {
    if (this.timer) return;
    this.timer = setInterval(() => void this.runDueSchedules(), this.tickIntervalMs);
    this.timer.unref?.();
  }

  stop(): void {
    if (!this.timer) return;
    clearInterval(this.timer);
    this.timer = null;
  }

  get isRunning(): boolean {
    return this.timer !== null;
  }

  get scheduleNames(): string[] {
    return [...this.schedules.keys()];
  }

  /**
   * Enqueues every occurrence that has become due since the last call.
   * Called on a timer by `start()`, and directly by tests so scheduling
   * can be asserted without waiting on wall-clock time.
   *
   * Returns the number of jobs actually created — occurrences that were
   * de-duplicated away (already enqueued by another instance) are not
   * counted.
   */
  async runDueSchedules(): Promise<number> {
    const now = this.now();
    let created = 0;

    for (const state of this.schedules.values()) {
      const { definition } = state;
      const limit = definition.repeat.limit;

      for (;;) {
        if (limit !== undefined && state.runs >= limit) break;

        const occurrence = nextOccurrence(definition.repeat, state.cursor);
        if (occurrence === null || occurrence > now) break;

        state.cursor = occurrence;
        state.runs += 1;

        const job = await definition.queue.add(definition.jobName, definition.data as never, {
          ...definition.jobOptions,
          jobId: `repeat:${definition.name}:${occurrence}`,
        });
        if (job) created += 1;
      }
    }

    return created;
  }
}

function validateRepeat(repeat: RepeatOptions, scheduleName: string): void {
  const hasEvery = repeat.every !== undefined;
  const hasPattern = repeat.pattern !== undefined;

  if (hasEvery === hasPattern) {
    throw new Error(
      `Schedule ${JSON.stringify(scheduleName)} must specify exactly one of "every" or "pattern", not both or neither.`,
    );
  }
  if (hasEvery && (!Number.isFinite(repeat.every) || repeat.every! <= 0)) {
    throw new RangeError(`Schedule ${JSON.stringify(scheduleName)}: "every" must be a positive number of milliseconds.`);
  }
  if (hasPattern) parseCronExpression(repeat.pattern!); // throws on a malformed expression, at registration time
}

/** The first occurrence strictly after `after`, in epoch ms, or `null` if there is none. */
export function nextOccurrence(repeat: RepeatOptions, after: number): number | null {
  if (repeat.every !== undefined) {
    return (Math.floor(after / repeat.every) + 1) * repeat.every;
  }

  const next = nextCronOccurrence(parseCronExpression(repeat.pattern!), new Date(after));
  return next === null ? null : next.getTime();
}
