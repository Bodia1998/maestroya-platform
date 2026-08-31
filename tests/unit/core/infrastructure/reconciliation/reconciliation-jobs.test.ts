import { describe, expect, it } from "vitest";

import { reconciliationRunJobIdempotencyKey } from "@/infrastructure/reconciliation/reconciliation-jobs";
import type { ActiveJob } from "@/infrastructure/jobs/job-types";
import type { ReconciliationRunJobData } from "@/infrastructure/reconciliation/reconciliation-jobs";

function makeJob(data: ReconciliationRunJobData): ActiveJob<ReconciliationRunJobData> {
  return { id: "job-1", queue: "reconciliation-run", name: "reconciliation.run", data, attempt: 1, maxAttempts: 3 };
}

describe("infrastructure/reconciliation/reconciliation-jobs", () => {
  it("opts every job out of execution-time de-duplication (always returns null)", () => {
    const job = makeJob({ scope: "FULL", limit: 500, reason: "scheduled" });
    expect(reconciliationRunJobIdempotencyKey(job)).toBeNull();

    const anotherJob = makeJob({ scope: "PAYOUT", limit: 100, reason: "manual" });
    expect(reconciliationRunJobIdempotencyKey(anotherJob)).toBeNull();
  });
});
