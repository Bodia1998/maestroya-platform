import { describe, expect, it, vi } from "vitest";

import {
  guardLeadPublication,
  guardLeadPurchaseInitiation,
  observeLeadContactAccess,
} from "@/application/use-cases/lead-abuse/compose";
import {
  LeadAbuseGuardedInitiatePurchase,
  LeadAbuseGuardedPublishLead,
  LeadAbuseObservedGetLeadContact,
} from "@/application/use-cases/lead-abuse/lead-abuse-guards";
import { defaultLeadAbuseControlConfig } from "@/domain/services/lead-abuse-controls";
import { loadLeadAbuseControlConfig } from "@/infrastructure/config/lead-abuse-control-config";

vi.mock("@/infrastructure/observability/logger", () => ({
  logger: { warn: vi.fn(), info: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

const inner = () => ({ execute: async () => "ok" });

describe("M156 — composition and default configuration", () => {
  it("with no configuration at all the environment loader yields OFF", () => {
    expect(loadLeadAbuseControlConfig({}).mode).toBe("OFF");
    expect(loadLeadAbuseControlConfig({ LEAD_ABUSE_CONTROL_MODE: "" }).mode).toBe("OFF");
    expect(loadLeadAbuseControlConfig({ LEAD_ABUSE_CONTROL_MODE: "yes please" }).mode).toBe("OFF");
  });

  it("the test environment itself is OFF (nothing in the existing suites is guarded)", () => {
    expect(loadLeadAbuseControlConfig().mode).toBe("OFF");
  });

  it("OFF returns the wrapped use case itself: the pre-M156 code path, same object", () => {
    const off = defaultLeadAbuseControlConfig("OFF");
    const a = inner();
    const b = inner();
    const c = inner();
    expect(guardLeadPublication(a, off)).toBe(a);
    expect(guardLeadPurchaseInitiation(b, off)).toBe(b);
    expect(observeLeadContactAccess(c, off)).toBe(c);
  });

  it("every active mode wraps; contact is only ever OBSERVED, never guarded", () => {
    for (const mode of ["SHADOW", "FLAG", "ENFORCE"] as const) {
      const cfg = defaultLeadAbuseControlConfig(mode);
      expect(guardLeadPublication(inner(), cfg)).toBeInstanceOf(LeadAbuseGuardedPublishLead);
      expect(guardLeadPurchaseInitiation(inner(), cfg)).toBeInstanceOf(LeadAbuseGuardedInitiatePurchase);
      expect(observeLeadContactAccess(inner(), cfg)).toBeInstanceOf(LeadAbuseObservedGetLeadContact);
    }
  });

  it("the environment loader reads the switch on every call (rollout / rollback lever)", () => {
    const env: Record<string, string | undefined> = {};
    expect(loadLeadAbuseControlConfig(env).mode).toBe("OFF");
    env.LEAD_ABUSE_CONTROL_MODE = "ENFORCE";
    expect(loadLeadAbuseControlConfig(env).mode).toBe("ENFORCE");
    env.LEAD_ABUSE_CONTROL_MODE = "OFF";
    expect(loadLeadAbuseControlConfig(env).mode).toBe("OFF");
  });
});
