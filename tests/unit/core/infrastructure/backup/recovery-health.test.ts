import { describe, expect, it } from "vitest";

import { collectRecoveryHealth, DISABLED_RECOVERY_HEALTH } from "@/infrastructure/backup/recovery-health";
import type { RecoveryReadinessReport } from "@/application/services/recovery/recovery-readiness-service";

function report(status: RecoveryReadinessReport["status"]): RecoveryReadinessReport {
  return { status, plans: [], issues: [] };
}

describe("infrastructure/backup/recovery-health", () => {
  it("DISABLED_RECOVERY_HEALTH is the disabled sentinel", () => {
    expect(DISABLED_RECOVERY_HEALTH.status).toBe("disabled");
  });

  it("maps 'ready' to 'ok'", () => {
    expect(collectRecoveryHealth(report("ready")).status).toBe("ok");
  });

  it("maps 'at_risk' to 'at_risk'", () => {
    expect(collectRecoveryHealth(report("at_risk")).status).toBe("at_risk");
  });

  it("maps 'not_ready' to 'degraded'", () => {
    expect(collectRecoveryHealth(report("not_ready")).status).toBe("degraded");
  });

  it("carries the full readiness report through unchanged", () => {
    const readiness = report("ready");
    expect(collectRecoveryHealth(readiness).readiness).toBe(readiness);
  });
});
