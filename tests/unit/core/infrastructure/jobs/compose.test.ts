import { afterEach, describe, expect, it, vi } from "vitest";

import { VALID_BASE_ENV } from "../config/env-fixture";

/**
 * Module 45 — Background Jobs (Roadmap Module 12).
 *
 * Same `vi.resetModules()` + dynamic-import pattern as
 * `cache-service-factory.test.ts` (Module 44) — `getBackgroundJobRuntime()`
 * and `jobDefaults` memoize/read module-level state, so each case needs a
 * fresh module graph to observe different env or a clean runtime.
 */
async function loadCompose(envOverrides: Record<string, string | undefined> = {}) {
  const mutableEnv = process.env as Record<string, string | undefined>;
  for (const [key, value] of Object.entries(VALID_BASE_ENV)) mutableEnv[key] = value;
  for (const [key, value] of Object.entries(envOverrides)) {
    if (value === undefined) delete mutableEnv[key];
    else mutableEnv[key] = value;
  }

  vi.resetModules();
  return import("@/infrastructure/jobs/compose");
}

describe("infrastructure/jobs/compose", () => {
  afterEach(() => {
    delete (process.env as Record<string, string | undefined>).QUEUE_CONCURRENCY;
    delete (process.env as Record<string, string | undefined>).QUEUE_MAX_ATTEMPTS;
  });

  it("getBackgroundJobRuntime() returns the same instance every call", async () => {
    const { getBackgroundJobRuntime } = await loadCompose();
    expect(getBackgroundJobRuntime()).toBe(getBackgroundJobRuntime());
  });

  it("jobDefaults reads QUEUE_CONCURRENCY/QUEUE_MAX_ATTEMPTS from the validated env", async () => {
    const { jobDefaults } = await loadCompose({ QUEUE_CONCURRENCY: "10", QUEUE_MAX_ATTEMPTS: "7" });
    expect(jobDefaults.concurrency).toBe(10);
    expect(jobDefaults.maxAttempts).toBe(7);
  });

  it("jobDefaults falls back to safe defaults on a malformed value rather than failing startup", async () => {
    const { jobDefaults } = await loadCompose({ QUEUE_CONCURRENCY: "not-a-number" });
    expect(jobDefaults.concurrency).toBe(5);
  });

  it("getBackgroundJobsHealth() is 'disabled' before any queue is registered", async () => {
    const { getBackgroundJobsHealth } = await loadCompose();
    expect(await getBackgroundJobsHealth()).toEqual({ status: "disabled", driver: "none", queues: {} });
  });

  it("createManagedQueue registers the queue so it shows up in health and is closed on shutdown", async () => {
    const { createManagedQueue, getBackgroundJobsHealth, shutdownBackgroundJobs } = await loadCompose();

    const queue = createManagedQueue<{ n: number }>("test-queue");
    await queue.add("do-thing", { n: 1 });

    const health = await getBackgroundJobsHealth();
    expect(health.status).toBe("ok");
    expect(health.queues["test-queue"]?.waiting).toBe(1);

    await shutdownBackgroundJobs();
    expect(queue.isClosed).toBe(true);
  });

  it("registering the same queue name twice throws", async () => {
    const { createManagedQueue } = await loadCompose();
    createManagedQueue("dup-queue");
    expect(() => createManagedQueue("dup-queue")).toThrow();
  });

  it("startBackgroundJobs()/shutdownBackgroundJobs() are idempotent and safe when nothing was registered", async () => {
    const { startBackgroundJobs, shutdownBackgroundJobs } = await loadCompose();
    expect(() => startBackgroundJobs()).not.toThrow();
    expect(() => startBackgroundJobs()).not.toThrow();
    await expect(shutdownBackgroundJobs()).resolves.toBeUndefined();
    await expect(shutdownBackgroundJobs()).resolves.toBeUndefined();
  });

  it("a worker registered after start() is started immediately rather than sitting idle", async () => {
    const { getBackgroundJobRuntime, startBackgroundJobs } = await loadCompose();
    startBackgroundJobs();

    let started = false;
    getBackgroundJobRuntime().registerWorker({
      queueName: "late",
      start: () => {
        started = true;
      },
      close: async () => {},
    });

    expect(started).toBe(true);
  });

  it("getJobObserver() returns the same observer instance every call", async () => {
    const { getJobObserver } = await loadCompose();
    expect(getJobObserver()).toBe(getJobObserver());
  });
});
