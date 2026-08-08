import { describe, expect, it } from "vitest";

import {
  analyticsRefreshJobId,
  analyticsRefreshJobIdempotencyKey,
  type AnalyticsRefreshJobData,
} from "@/infrastructure/analytics/analytics-refresh-jobs";
import type { ActiveJob } from "@/infrastructure/jobs/job-types";

describe("infrastructure/analytics/analytics-refresh-jobs", () => {
  it("every 'refresh' job shares the same coalesced job id, regardless of reason/eventId", () => {
    const a = analyticsRefreshJobId({ operation: "refresh", reason: "review.created", eventId: "evt-1" });
    const b = analyticsRefreshJobId({ operation: "refresh", reason: "dispute.created", eventId: "evt-2" });
    const c = analyticsRefreshJobId({ operation: "refresh", reason: "scheduled" });

    expect(a).toBe(b);
    expect(b).toBe(c);
  });

  it("'rebuild' jobs are keyed by reason, distinct from the coalesced refresh id", () => {
    const refresh = analyticsRefreshJobId({ operation: "refresh", reason: "review.created" });
    const rebuild = analyticsRefreshJobId({ operation: "rebuild", reason: "manual-rebuild" });

    expect(rebuild).not.toBe(refresh);
    expect(rebuild).toBe(analyticsRefreshJobId({ operation: "rebuild", reason: "manual-rebuild" }));
  });

  it("analyticsRefreshJobIdempotencyKey always opts out of execution-time de-duplication", () => {
    const job = { data: { operation: "refresh", reason: "review.created" } } as unknown as ActiveJob<AnalyticsRefreshJobData>;
    expect(analyticsRefreshJobIdempotencyKey(job)).toBeNull();

    const rebuildJob = {
      data: { operation: "rebuild", reason: "manual-rebuild" },
    } as unknown as ActiveJob<AnalyticsRefreshJobData>;
    expect(analyticsRefreshJobIdempotencyKey(rebuildJob)).toBeNull();
  });
});
