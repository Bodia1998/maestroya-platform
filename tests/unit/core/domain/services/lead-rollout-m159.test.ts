import { describe, expect, it } from "vitest";

import { DomainError } from "@/domain/errors/domain-error";
import {
  DEFAULT_LEAD_ROLLOUT_MODE,
  LEAD_ROLLOUT_AREAS,
  LEAD_ROLLOUT_MODES,
  LEAD_ROLLOUT_MODE_ENV,
  LEAD_ROLLOUT_UNAVAILABLE_CONFIG,
  LeadV1RolloutDisabledError,
  describeLeadRollout,
  isLeadRolloutAreaOpen,
  parseLeadRolloutConfig,
} from "@/domain/services/lead-rollout";

describe("M159 — rollout mode parsing (safe by default)", () => {
  it("the switch has exactly one spelling and the default is DISABLED", () => {
    expect(LEAD_ROLLOUT_MODE_ENV).toBe("LEAD_V1_ROLLOUT_MODE");
    expect(DEFAULT_LEAD_ROLLOUT_MODE).toBe("DISABLED");
    expect([...LEAD_ROLLOUT_MODES]).toEqual(["DISABLED", "ENTRY_ONLY", "PURCHASE_ONLY", "ENABLED"]);
  });

  it.each([undefined, null, ""])("%j (missing) is DISABLED with status DEFAULT", (raw) => {
    expect(parseLeadRolloutConfig(raw)).toEqual({ mode: "DISABLED", status: "DEFAULT" });
  });

  it.each([...LEAD_ROLLOUT_MODES])("the exact name %s is CONFIGURED", (mode) => {
    expect(parseLeadRolloutConfig(mode)).toEqual({ mode, status: "CONFIGURED" });
  });

  it.each([
    "enabled",
    "Enabled",
    " ENABLED",
    "ENABLED ",
    "ENABLED\n",
    "true",
    "TRUE",
    "on",
    "1",
    "yes",
    "ENABLE",
    "ENTRY",
    "PURCHASE",
    "ENTRY_ONLY,PURCHASE_ONLY",
    "ALL",
    "false",
    "0",
    "off",
    "OFF",
    "constructor",
    "__proto__",
    5,
    true,
    {},
    [],
    ["ENABLED"],
  ])("the invalid value %j is MISCONFIGURED and behaves as DISABLED — never towards enabled", (raw) => {
    expect(parseLeadRolloutConfig(raw)).toEqual({ mode: "DISABLED", status: "MISCONFIGURED" });
  });

  it("the 'switch cannot be read' configuration is the same fail-safe outcome", () => {
    expect(LEAD_ROLLOUT_UNAVAILABLE_CONFIG).toEqual({ mode: "DISABLED", status: "MISCONFIGURED" });
  });
});

describe("M159 — which area each mode opens", () => {
  const matrix: Array<[string, boolean, boolean]> = [
    ["DISABLED", false, false],
    ["ENTRY_ONLY", true, false],
    ["PURCHASE_ONLY", false, true],
    ["ENABLED", true, true],
  ];
  it.each(matrix)("%s: ENTRY=%s PURCHASE=%s", (mode, entry, purchase) => {
    expect(isLeadRolloutAreaOpen(mode, "ENTRY")).toBe(entry);
    expect(isLeadRolloutAreaOpen(mode, "PURCHASE")).toBe(purchase);
  });

  it("only ENABLED opens everything, and only DISABLED opens nothing", () => {
    for (const mode of LEAD_ROLLOUT_MODES) {
      const open = LEAD_ROLLOUT_AREAS.filter((area) => isLeadRolloutAreaOpen(mode, area));
      if (mode === "ENABLED") expect(open).toHaveLength(LEAD_ROLLOUT_AREAS.length);
      if (mode === "DISABLED") expect(open).toHaveLength(0);
    }
  });

  it.each([undefined, null, "", "enabled", "constructor", "__proto__", "toString", 1, {}])("an unknown mode %j opens nothing", (mode) => {
    for (const area of LEAD_ROLLOUT_AREAS) expect(isLeadRolloutAreaOpen(mode, area)).toBe(false);
  });

  it.each([undefined, null, "", "entry", "ALL", "constructor", 1, {}])("an unknown area %j is closed even in ENABLED", (area) => {
    expect(isLeadRolloutAreaOpen("ENABLED", area)).toBe(false);
  });
});

describe("M159 — admin view and the uniform refusal", () => {
  it("describes the effective state without echoing any raw value", () => {
    expect(describeLeadRollout({ mode: "ENTRY_ONLY", status: "CONFIGURED" })).toEqual({ mode: "ENTRY_ONLY", status: "CONFIGURED", entryOpen: true, purchaseOpen: false });
    expect(describeLeadRollout(parseLeadRolloutConfig("garbage"))).toEqual({ mode: "DISABLED", status: "MISCONFIGURED", entryOpen: false, purchaseOpen: false });
  });

  it("the refusal is a DomainError with a fixed code and a message that leaks neither area, mode nor configuration", () => {
    const error = new LeadV1RolloutDisabledError();
    expect(error).toBeInstanceOf(DomainError);
    expect(error.code).toBe("LEAD_V1_ROLLOUT_DISABLED");
    expect(error.message).toBe("This feature is not available right now.");
    expect(error.message).not.toMatch(/ENTRY|PURCHASE|DISABLED|ENABLED|LEAD_V1|ROLLOUT|misconfig|env/i);
    expect(new LeadV1RolloutDisabledError().message).toBe(error.message);
  });
});
