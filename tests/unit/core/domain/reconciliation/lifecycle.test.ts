import { describe, expect, it } from "vitest";

import { canTransitionReconciliationRunStatus, isTerminalReconciliationRunStatus } from "@/domain/services/reconciliation/lifecycle";

describe("canTransitionReconciliationRunStatus", () => {
  it("allows RUNNING -> COMPLETED", () => {
    expect(canTransitionReconciliationRunStatus("RUNNING", "COMPLETED")).toBe(true);
  });

  it("allows RUNNING -> FAILED", () => {
    expect(canTransitionReconciliationRunStatus("RUNNING", "FAILED")).toBe(true);
  });

  it("disallows RUNNING -> RUNNING", () => {
    expect(canTransitionReconciliationRunStatus("RUNNING", "RUNNING")).toBe(false);
  });

  it("disallows any transition out of COMPLETED", () => {
    expect(canTransitionReconciliationRunStatus("COMPLETED", "RUNNING")).toBe(false);
    expect(canTransitionReconciliationRunStatus("COMPLETED", "FAILED")).toBe(false);
  });

  it("disallows any transition out of FAILED", () => {
    expect(canTransitionReconciliationRunStatus("FAILED", "RUNNING")).toBe(false);
    expect(canTransitionReconciliationRunStatus("FAILED", "COMPLETED")).toBe(false);
  });
});

describe("isTerminalReconciliationRunStatus", () => {
  it("treats RUNNING as non-terminal", () => {
    expect(isTerminalReconciliationRunStatus("RUNNING")).toBe(false);
  });

  it("treats COMPLETED and FAILED as terminal", () => {
    expect(isTerminalReconciliationRunStatus("COMPLETED")).toBe(true);
    expect(isTerminalReconciliationRunStatus("FAILED")).toBe(true);
  });
});
