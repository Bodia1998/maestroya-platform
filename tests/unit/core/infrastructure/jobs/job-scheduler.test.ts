import { describe, expect, it } from "vitest";

import { InMemoryJobStore } from "@/infrastructure/jobs/in-memory-job-store";
import { JobScheduler, nextOccurrence } from "@/infrastructure/jobs/job-scheduler";
import { Queue } from "@/infrastructure/jobs/queue";

describe("infrastructure/jobs/job-scheduler", () => {
  describe("nextOccurrence", () => {
    it("epoch-aligns an 'every' schedule rather than being relative to registration time", () => {
      // every 10 minutes, aligned to the hour: after 00:03 the next run is 00:10, not 00:13.
      const after = new Date("2026-08-07T00:03:00.000Z").getTime();
      const next = nextOccurrence({ every: 10 * 60_000 }, after);
      expect(new Date(next!).toISOString()).toBe("2026-08-07T00:10:00.000Z");
    });

    it("resolves a cron pattern via cron-expression.ts", () => {
      const after = new Date("2026-08-07T00:00:00.000Z").getTime();
      const next = nextOccurrence({ pattern: "0 3 * * *" }, after);
      expect(new Date(next!).toISOString()).toBe("2026-08-07T03:00:00.000Z");
    });
  });

  describe("register", () => {
    it("rejects a schedule with neither 'every' nor 'pattern'", () => {
      const scheduler = new JobScheduler();
      const store = new InMemoryJobStore();
      const queue = new Queue("reminders", { store });
      expect(() => scheduler.register({ name: "s", queue, jobName: "tick", data: {}, repeat: {} })).toThrow();
    });

    it("rejects a schedule with both 'every' and 'pattern'", () => {
      const scheduler = new JobScheduler();
      const store = new InMemoryJobStore();
      const queue = new Queue("reminders", { store });
      expect(() =>
        scheduler.register({ name: "s", queue, jobName: "tick", data: {}, repeat: { every: 1000, pattern: "* * * * *" } }),
      ).toThrow();
    });

    it("rejects a malformed cron pattern at registration time, not at run time", () => {
      const scheduler = new JobScheduler();
      const store = new InMemoryJobStore();
      const queue = new Queue("reminders", { store });
      expect(() =>
        scheduler.register({ name: "s", queue, jobName: "tick", data: {}, repeat: { pattern: "not a cron" } }),
      ).toThrow();
    });

    it("rejects registering two schedules with the same name", () => {
      const scheduler = new JobScheduler();
      const store = new InMemoryJobStore();
      const queue = new Queue("reminders", { store });
      scheduler.register({ name: "dup", queue, jobName: "tick", data: {}, repeat: { every: 1000 } });
      expect(() =>
        scheduler.register({ name: "dup", queue, jobName: "tick", data: {}, repeat: { every: 1000 } }),
      ).toThrow();
    });
  });

  describe("runDueSchedules", () => {
    it("enqueues a job onto the schedule's queue once an occurrence is due", async () => {
      let now = 0;
      const scheduler = new JobScheduler({ now: () => now });
      const store = new InMemoryJobStore();
      const queue = new Queue("reminders", { store });
      scheduler.register({ name: "every-second", queue, jobName: "tick", data: { n: 1 }, repeat: { every: 1000 } });

      expect(await scheduler.runDueSchedules()).toBe(0);

      now = 1000;
      expect(await scheduler.runDueSchedules()).toBe(1);
      expect((await queue.getCounts()).waiting).toBe(1);
    });

    it("enqueues every occurrence that became due since the last check, in one call", async () => {
      let now = 0;
      const scheduler = new JobScheduler({ now: () => now });
      const store = new InMemoryJobStore();
      const queue = new Queue("reminders", { store });
      scheduler.register({ name: "every-second", queue, jobName: "tick", data: {}, repeat: { every: 1000 } });

      now = 3500; // three occurrences (1000, 2000, 3000) are now due
      expect(await scheduler.runDueSchedules()).toBe(3);
      expect((await queue.getCounts()).waiting).toBe(3);
    });

    it("two instances computing the same due occurrence enqueue exactly one job (deterministic id)", async () => {
      // `register()` seeds each schedule's cursor from `now()` at
      // registration time, and an occurrence only fires strictly *after*
      // the cursor (see nextOccurrence's epoch-alignment comment) — so
      // both instances must register while `now` is still before the
      // occurrence under test (0), then advance to the due instant (1000)
      // before checking, exactly like the single-instance case above.
      let now = 0;
      const store = new InMemoryJobStore();
      const queue = new Queue("reminders", { store, now: () => now });

      const instanceA = new JobScheduler({ now: () => now });
      const instanceB = new JobScheduler({ now: () => now });
      instanceA.register({ name: "shared", queue, jobName: "tick", data: {}, repeat: { every: 1000 } });
      instanceB.register({ name: "shared", queue, jobName: "tick", data: {}, repeat: { every: 1000 } });

      now = 1000;
      await instanceA.runDueSchedules();
      await instanceB.runDueSchedules();

      expect((await queue.getCounts()).waiting).toBe(1);
    });

    it("stops enqueuing once the schedule's run limit is reached", async () => {
      let now = 0;
      const scheduler = new JobScheduler({ now: () => now });
      const store = new InMemoryJobStore();
      const queue = new Queue("reminders", { store });
      scheduler.register({ name: "limited", queue, jobName: "tick", data: {}, repeat: { every: 1000, limit: 2 } });

      now = 10_000;
      expect(await scheduler.runDueSchedules()).toBe(2);
      expect(await scheduler.runDueSchedules()).toBe(0);
    });
  });

  describe("start/stop", () => {
    it("start() then stop() toggles isRunning", () => {
      const scheduler = new JobScheduler({ tickIntervalMs: 10_000 });
      expect(scheduler.isRunning).toBe(false);
      scheduler.start();
      expect(scheduler.isRunning).toBe(true);
      scheduler.stop();
      expect(scheduler.isRunning).toBe(false);
    });

    it("start() is idempotent (calling twice does not create two timers)", () => {
      const scheduler = new JobScheduler({ tickIntervalMs: 10_000 });
      scheduler.start();
      scheduler.start();
      expect(scheduler.isRunning).toBe(true);
      scheduler.stop();
    });
  });
});
