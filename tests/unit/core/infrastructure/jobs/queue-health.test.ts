import { describe, expect, it } from "vitest";

import { collectQueueHealth, DISABLED_QUEUE_HEALTH } from "@/infrastructure/jobs/queue-health";
import { EMPTY_QUEUE_COUNTS } from "@/infrastructure/jobs/job-types";
import type { QueueCounts } from "@/infrastructure/jobs/job-types";

describe("infrastructure/jobs/queue-health", () => {
  it("DISABLED_QUEUE_HEALTH represents the default, healthy 'no queues registered' state", () => {
    expect(DISABLED_QUEUE_HEALTH).toEqual({ status: "disabled", driver: "none", queues: {} });
  });

  it("collects counts from every queue, keyed by name", async () => {
    const counts: QueueCounts = { ...EMPTY_QUEUE_COUNTS, waiting: 2, completed: 5 };
    const report = await collectQueueHealth(
      [
        { name: "domain-events", getCounts: async () => counts },
        { name: "domain-events-dead-letter", getCounts: async () => EMPTY_QUEUE_COUNTS },
      ],
      "memory",
    );

    expect(report).toEqual({
      status: "ok",
      driver: "memory",
      queues: {
        "domain-events": counts,
        "domain-events-dead-letter": EMPTY_QUEUE_COUNTS,
      },
    });
  });

  it("never throws: a failing queue's getCounts() becomes status 'error' with its message", async () => {
    const report = await collectQueueHealth(
      [
        {
          name: "domain-events",
          getCounts: async () => {
            throw new Error("store unreachable");
          },
        },
      ],
      "redis",
    );

    expect(report.status).toBe("error");
    expect(report.error).toBe("store unreachable");
  });

  it("reports the driver it was given ('redis' vs 'memory')", async () => {
    const report = await collectQueueHealth([], "redis");
    expect(report.driver).toBe("redis");
  });
});
