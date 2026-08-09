import { describe, expect, it, vi } from "vitest";

import { DisasterRecoveryService } from "@/application/services/recovery/disaster-recovery-service";
import type { DisasterRecoveryPlan } from "@/domain/entities/disaster-recovery";
import type { RecoveryExecution } from "@/domain/entities/disaster-recovery";
import type { RecoveryExecutionRepository } from "@/domain/repositories/recovery-execution-repository";

const plan: DisasterRecoveryPlan = {
  id: "plan-1",
  name: "Test plan",
  description: "...",
  rtoMinutes: 60,
  rpoMinutes: 1440,
  steps: [
    { id: "automated-1", order: 1, title: "Automated 1", description: "...", automated: true },
    { id: "manual-1", order: 2, title: "Manual 1", description: "...", automated: false },
    { id: "automated-2", order: 3, title: "Automated 2", description: "...", automated: true },
  ],
};

function fakeRepository(): RecoveryExecutionRepository & { saved: RecoveryExecution[] } {
  const saved: RecoveryExecution[] = [];
  return {
    saved,
    save: vi.fn(async (execution: RecoveryExecution) => {
      saved.push(execution);
    }),
    findById: vi.fn(async () => null),
    findLatestByPlanId: vi.fn(async () => null),
    findLatestSuccessfulDrillByPlanId: vi.fn(async () => null),
  };
}

describe("application/services/recovery/disaster-recovery-service", () => {
  const now = new Date("2026-06-01T00:00:00.000Z");

  it("runs every automated step, skips manual steps, and completes", async () => {
    const repository = fakeRepository();
    const service = new DisasterRecoveryService({ repository, generateId: () => "exec-1", now: () => now });

    const execution = await service.execute(
      plan,
      { "automated-1": vi.fn().mockResolvedValue(undefined), "automated-2": vi.fn().mockResolvedValue(undefined) },
      "test run",
      true,
    );

    expect(execution.status).toBe("COMPLETED");
    expect(execution.checkpoints.map((checkpoint) => [checkpoint.stepId, checkpoint.status])).toEqual([
      ["automated-1", "COMPLETED"],
      ["manual-1", "SKIPPED"],
      ["automated-2", "COMPLETED"],
    ]);
  });

  it("fails the whole execution immediately when an automated step throws, without running later steps", async () => {
    const repository = fakeRepository();
    const service = new DisasterRecoveryService({ repository, generateId: () => "exec-2", now: () => now });
    const secondHandler = vi.fn();

    const execution = await service.execute(
      plan,
      {
        "automated-1": vi.fn().mockRejectedValue(new Error("restore failed")),
        "automated-2": secondHandler,
      },
      "test run",
      false,
    );

    expect(execution.status).toBe("FAILED");
    expect(execution.failureReason).toContain("restore failed");
    expect(execution.checkpoints).toHaveLength(1);
    expect(execution.checkpoints[0]).toMatchObject({ stepId: "automated-1", status: "FAILED" });
    expect(secondHandler).not.toHaveBeenCalled();
  });

  it("fails when an automated step has no registered handler", async () => {
    const repository = fakeRepository();
    const service = new DisasterRecoveryService({ repository, generateId: () => "exec-3", now: () => now });

    const execution = await service.execute(plan, {}, "test run", false);

    expect(execution.status).toBe("FAILED");
    expect(execution.checkpoints.at(0)?.status).toBe("FAILED");
  });

  it("persists the execution at every stage (start, each checkpoint's terminal save, completion)", async () => {
    const repository = fakeRepository();
    const service = new DisasterRecoveryService({ repository, generateId: () => "exec-4", now: () => now });

    await service.execute(
      plan,
      { "automated-1": vi.fn().mockResolvedValue(undefined), "automated-2": vi.fn().mockResolvedValue(undefined) },
      "test run",
      true,
    );

    expect(repository.save).toHaveBeenCalled();
    expect(repository.saved.at(-1)?.status).toBe("COMPLETED");
  });
});
