import type { JobStore } from "@/infrastructure/jobs/job-store";
import type { QueueCounts, StoredJob } from "@/infrastructure/jobs/job-types";
import { EMPTY_QUEUE_COUNTS } from "@/infrastructure/jobs/job-types";

/**
 * Module 45 — Background Jobs (Roadmap Module 12).
 *
 * Process-local `JobStore`, and the default whenever `REDIS_URL` is
 * unset — exactly the same "correct in-memory fallback, never a startup
 * failure" convention `cache-service-factory.ts`,
 * `rate-limit-repository-factory.ts`, and `lock-service-factory.ts`
 * already follow (Module 44). Local dev, most CI runs, and any
 * single-instance deployment get fully working background jobs with no
 * infrastructure to stand up.
 *
 * The honest limits, which are the same limits `InMemoryCacheService`
 * has and which `docs/MODULE_45_BACKGROUND_JOBS.md` records under "Known
 * limitations": jobs do not survive a process restart, and two instances
 * do not share a queue. Both are acceptable for the deployment shapes
 * above and unacceptable for a multi-instance production deployment —
 * which is precisely the case where `REDIS_URL` is set and
 * `RedisJobStore` takes over.
 */
export class InMemoryJobStore implements JobStore {
  private readonly pending = new Map<string, StoredJob[]>();
  private readonly active = new Map<string, StoredJob[]>();
  private readonly knownIds = new Map<string, Set<string>>();
  private readonly completedCount = new Map<string, number>();
  private readonly failedCount = new Map<string, number>();

  async add(job: StoredJob): Promise<StoredJob | null> {
    const ids = this.bucket(this.knownIds, job.queue, () => new Set<string>());
    if (ids.has(job.id)) return null;
    ids.add(job.id);

    this.bucket(this.pending, job.queue, () => []).push({ ...job });
    return job;
  }

  async reserve(queue: string, now: number): Promise<StoredJob | null> {
    const waiting = this.pending.get(queue);
    if (!waiting || waiting.length === 0) return null;

    // Earliest-due first, so a job delayed by backoff never overtakes an
    // older job that is already due — FIFO among due jobs, which is what
    // BullMQ's own waiting list gives.
    let bestIndex = -1;
    for (let index = 0; index < waiting.length; index += 1) {
      const candidate = waiting[index]!;
      if (candidate.processAt > now) continue;
      if (bestIndex === -1 || candidate.processAt < waiting[bestIndex]!.processAt) bestIndex = index;
    }
    if (bestIndex === -1) return null;

    const [job] = waiting.splice(bestIndex, 1);
    const reserved: StoredJob = { ...job!, attemptsMade: job!.attemptsMade + 1 };
    this.bucket(this.active, queue, () => []).push(reserved);
    return reserved;
  }

  async complete(job: StoredJob): Promise<void> {
    this.removeActive(job);
    this.completedCount.set(job.queue, (this.completedCount.get(job.queue) ?? 0) + 1);
  }

  async retry(job: StoredJob, processAt: number, failedReason: string): Promise<void> {
    this.removeActive(job);
    this.bucket(this.pending, job.queue, () => []).push({ ...job, processAt, failedReason });
  }

  async fail(job: StoredJob, failedReason: string): Promise<void> {
    this.removeActive(job);
    this.failedCount.set(job.queue, (this.failedCount.get(job.queue) ?? 0) + 1);
    void failedReason;
  }

  async counts(queue: string, now: number): Promise<QueueCounts> {
    const waiting = this.pending.get(queue) ?? [];

    return {
      ...EMPTY_QUEUE_COUNTS,
      waiting: waiting.filter((job) => job.processAt <= now).length,
      delayed: waiting.filter((job) => job.processAt > now).length,
      active: (this.active.get(queue) ?? []).length,
      completed: this.completedCount.get(queue) ?? 0,
      failed: this.failedCount.get(queue) ?? 0,
    };
  }

  async drain(queue: string): Promise<void> {
    this.pending.set(queue, []);
  }

  async close(): Promise<void> {
    this.pending.clear();
    this.active.clear();
    this.knownIds.clear();
    this.completedCount.clear();
    this.failedCount.clear();
  }

  private removeActive(job: StoredJob): void {
    const active = this.active.get(job.queue);
    if (!active) return;
    const index = active.findIndex((candidate) => candidate.id === job.id);
    if (index >= 0) active.splice(index, 1);
  }

  private bucket<T>(map: Map<string, T>, queue: string, create: () => T): T {
    const existing = map.get(queue);
    if (existing !== undefined) return existing;
    const created = create();
    map.set(queue, created);
    return created;
  }
}
