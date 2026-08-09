import { describe, expect, it } from "vitest";

import { RecoveryExecution } from "@/domain/entities/disaster-recovery";
import { InvalidRecoveryTransitionError } from "@/domain/errors/domain-error";
import type { DisasterRecoveryPlan } from "@/domain/entities/disaster-recovery";

const plan: DisasterRecoveryPlan = {
  id: "test-plan",
  name: "Test plan",
  description: "A plan for tests.",
  rtoMinutes: 60,
  rpoMinutes: 1440,
  steps: [
    { id: "step-1", order: 1, title: "Step 1", description: "...", automated: true },
    { id: "step-2", order: 2, title: "Step 2", description: "...", automated: false },
  ],
};

describe("domain/entities/disaster-recovery — RecoveryExecution", () => {
  const t0 = new Date("2026-01-01T00:00:00.000Z");

  it("starts PENDING, begins, records checkpoints, and completes", () => {
    const execution = RecoveryExecution.start("e1", plan.id, "manual test", false, t0);
    expect(execution.status).toBe("PENDING");

    execution.begin();
    expect(execution.status).toBe("IN_PROGRESS");

    execution.recordCheckpoint("step-1", "COMPLETED", t0);
    execution.recordCheckpoint("step-2", "SKIPPED", t0, "Requires manual action.");
    expect(execution.checkpoints).toHaveLength(2);

    execution.complete(t0);
    expect(execution.status).toBe("COMPLETED");
    expect(execution.progressAgainst(plan)).toEqual({ completedSteps: 1, totalSteps: 2, percentage: 50 });
  });

  it("rejects recording a checkpoint before begin()", () => {
    const execution = RecoveryExecution.start("e2", plan.id, "manual test", false, t0);
    expect(() => execution.recordCheckpoint("step-1", "COMPLETED", t0)).toThrow(InvalidRecoveryTransitionError);
  });

  it("fail() records a reason and is terminal", () => {
    const execution = RecoveryExecution.start("e3", plan.id, "manual test", false, t0);
    execution.begin();
    execution.fail("step-1 failed", t0);
    expect(execution.status).toBe("FAILED");
    expect(execution.failureReason).toBe("step-1 failed");
    expect(() => execution.recordCheckpoint("step-2", "COMPLETED", t0)).toThrow(InvalidRecoveryTransitionError);
  });

  it("abort() is allowed from PENDING", () => {
    const execution = RecoveryExecution.start("e4", plan.id, "cancelled", false, t0);
    execution.abort("operator cancelled", t0);
    expect(execution.status).toBe("ABORTED");
  });

  it("rejects completing an execution twice", () => {
    const execution = RecoveryExecution.start("e5", plan.id, "manual test", true, t0);
    execution.begin();
    execution.complete(t0);
    expect(() => execution.complete(t0)).toThrow(InvalidRecoveryTransitionError);
  });

  it("rehydrate round-trips isDrill and checkpoints", () => {
    const execution = RecoveryExecution.rehydrate({
      id: "e6",
      planId: plan.id,
      triggeredBy: "scheduled drill",
      isDrill: true,
      status: "COMPLETED",
      startedAt: t0,
      completedAt: t0,
      checkpoints: [{ stepId: "step-1", status: "COMPLETED", reachedAt: t0, notes: null }],
      failureReason: null,
    });

    expect(execution.isDrill).toBe(true);
    expect(execution.checkpoints).toHaveLength(1);
  });
});
