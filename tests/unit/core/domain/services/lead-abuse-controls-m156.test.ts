import { describe, expect, it } from "vitest";

import {
  LEAD_ABUSE_RULES,
  LEAD_ABUSE_RULE_KEYS,
  LEAD_ABUSE_RULESET_VERSION,
  MAX_ADMIN_BLOCK_MS,
  MAX_AUTOMATED_BLOCK_MS,
  MIN_BLOCK_MS,
  LeadAbuseControlRejectedError,
  canTransitionLeadAbuseDecision,
  defaultLeadAbuseControlConfig,
  eventSignalDedupeKey,
  evaluateLeadAbuseRule,
  evaluateLeadAbuseRules,
  isBlockInForce,
  normalizeAdminBlockDurationMs,
  normalizeLeadAbuseNote,
  parseLeadAbuseControlConfig,
  parseLeadAbuseMode,
  planLeadAbuseEffect,
  riskLevelOf,
  ruleSignalDedupeKey,
} from "@/domain/services/lead-abuse-controls";

const USER = "11111111-1111-4111-8111-111111111111";
const NOW = new Date("2026-10-12T10:00:00.000Z");
const cfg = defaultLeadAbuseControlConfig("ENFORCE");

describe("M156 — mode parsing (safe by default)", () => {
  it("accepts exactly the four mode names", () => {
    for (const m of ["OFF", "SHADOW", "FLAG", "ENFORCE"]) expect(parseLeadAbuseMode(m)).toBe(m);
  });
  it.each([undefined, null, "", " ENFORCE", "enforce", "true", "1", "ON", 5, {}, "ENFORCE "])("%j is OFF", (v) => {
    expect(parseLeadAbuseMode(v)).toBe("OFF");
  });
  it("the default configuration is OFF", () => {
    expect(defaultLeadAbuseControlConfig().mode).toBe("OFF");
    expect(parseLeadAbuseControlConfig({}).config.mode).toBe("OFF");
  });
});

describe("M156 — rule table invariants", () => {
  it("only the two burst rules can block, each for at most 24 h, and block thresholds exceed flag thresholds", () => {
    const blockers = LEAD_ABUSE_RULE_KEYS.filter((k) => LEAD_ABUSE_RULES[k].blockedAction !== null);
    expect(blockers).toEqual(["PUBLICATION_BURST", "PURCHASE_INITIATION_BURST"]);
    for (const k of LEAD_ABUSE_RULE_KEYS) {
      const r = LEAD_ABUSE_RULES[k];
      expect(r.defaults.flagAt).toBeGreaterThanOrEqual(2);
      if (r.blockedAction === null) {
        expect(r.defaults.blockAt).toBeNull();
        expect(r.blockDurationMs).toBe(0);
      } else {
        expect(r.defaults.blockAt as number).toBeGreaterThan(r.defaults.flagAt);
        expect(r.blockDurationMs).toBeGreaterThan(0);
        expect(r.blockDurationMs).toBeLessThanOrEqual(MAX_AUTOMATED_BLOCK_MS);
      }
    }
  });
  it("dispute / revocation rules are RELIABLE facts yet never block (stronger restrictions need an administrator)", () => {
    for (const k of ["REPEATED_DISPUTES_OPENED", "REPEATED_DISPUTES_LOST", "REPEATED_REVOCATIONS"] as const) {
      expect(LEAD_ABUSE_RULES[k].reliability).toBe("RELIABLE");
      expect(LEAD_ABUSE_RULES[k].blockedAction).toBeNull();
    }
  });
  it("volume patterns are HEURISTIC", () => {
    for (const k of ["PUBLICATION_BURST", "DUPLICATE_REQUEST_CONTENT", "PURCHASE_INITIATION_BURST", "PURCHASE_REJECTED_PROBING", "CONTACT_ACCESS_DENIED_PROBING"] as const) {
      expect(LEAD_ABUSE_RULES[k].reliability).toBe("HEURISTIC");
    }
  });
});

describe("M156 — deterministic rule evaluation and edge cases", () => {
  const flagAt = cfg.thresholds.PUBLICATION_BURST.flagAt;
  const blockAt = cfg.thresholds.PUBLICATION_BURST.blockAt as number;

  it("below the flag threshold nothing happens; exactly at it flags; below the block threshold it stays a flag", () => {
    expect(evaluateLeadAbuseRule("PUBLICATION_BURST", flagAt - 1, cfg)).toBeNull();
    const flag = evaluateLeadAbuseRule("PUBLICATION_BURST", flagAt, cfg)!;
    expect(flag).toMatchObject({ recommendation: "FLAG_FOR_REVIEW", severity: "MEDIUM", threshold: flagAt, blockedAction: null, blockDurationMs: 0 });
    expect(evaluateLeadAbuseRule("PUBLICATION_BURST", blockAt - 1, cfg)!.recommendation).toBe("FLAG_FOR_REVIEW");
  });
  it("exactly at the block threshold a burst recommends a TEMPORARY_BLOCK of its own action with HIGH severity", () => {
    const hit = evaluateLeadAbuseRule("PUBLICATION_BURST", blockAt, cfg)!;
    expect(hit).toMatchObject({ recommendation: "TEMPORARY_BLOCK", severity: "HIGH", blockedAction: "LEAD_PUBLICATION", threshold: blockAt });
    expect(hit.blockDurationMs).toBeGreaterThan(0);
    expect(evaluateLeadAbuseRule("PURCHASE_INITIATION_BURST", 10_000, cfg)!.blockedAction).toBe("LEAD_PURCHASE_INITIATION");
  });
  it("a rule without a block action never recommends a block, however large the count", () => {
    for (const k of ["DUPLICATE_REQUEST_CONTENT", "PURCHASE_REJECTED_PROBING", "CONTACT_ACCESS_DENIED_PROBING", "REPEATED_DISPUTES_OPENED", "REPEATED_DISPUTES_LOST", "REPEATED_REVOCATIONS"] as const) {
      const hit = evaluateLeadAbuseRule(k, 1_000_000, cfg)!;
      // PURCHASE_REJECTED_PROBING is record-only (hardening): it records evidence but never flags or blocks
      expect(hit.recommendation).toBe(k === "PURCHASE_REJECTED_PROBING" ? "RECORD" : "FLAG_FOR_REVIEW");
      expect(hit.blockedAction).toBeNull();
    }
  });
  it.each([NaN, -1, 1.5, Infinity, "12", null, undefined, {}, [], Number.MAX_SAFE_INTEGER + 2])("malformed count %j is ignored (no accusation)", (v) => {
    expect(evaluateLeadAbuseRule("PUBLICATION_BURST", v, cfg)).toBeNull();
    expect(evaluateLeadAbuseRules(USER, { PUBLICATION_BURST: v }, cfg, NOW).hits).toEqual([]);
  });
  it("a corrupted threshold in the configuration never fires", () => {
    const broken = { ...cfg, thresholds: { ...cfg.thresholds, PUBLICATION_BURST: { flagAt: 0, blockAt: null } } };
    expect(evaluateLeadAbuseRule("PUBLICATION_BURST", 5, broken)).toBeNull();
    const nan = { ...cfg, thresholds: { ...cfg.thresholds, PUBLICATION_BURST: { flagAt: NaN, blockAt: null } } };
    expect(evaluateLeadAbuseRule("PUBLICATION_BURST", 5, nan)).toBeNull();
  });
  it("only the rules whose fact was supplied are evaluated, in the fixed rule order, and the result is reproducible", () => {
    const facts = { REPEATED_REVOCATIONS: 2, PUBLICATION_BURST: 10, DUPLICATE_REQUEST_CONTENT: 1 };
    const a = evaluateLeadAbuseRules(USER, facts, cfg, NOW);
    const b = evaluateLeadAbuseRules(USER, facts, cfg, NOW);
    expect(a).toEqual(b);
    expect(a.hits.map((h) => h.rule)).toEqual(["PUBLICATION_BURST", "REPEATED_REVOCATIONS"]);
    expect(a.rulesetVersion).toBe(LEAD_ABUSE_RULESET_VERSION);
    expect(a.riskLevel).toBe("HIGH");
  });
  it("risk level is the maximum severity, NONE without hits", () => {
    expect(riskLevelOf([])).toBe("NONE");
    expect(evaluateLeadAbuseRules(USER, { DUPLICATE_REQUEST_CONTENT: 3 }, cfg, NOW).riskLevel).toBe("LOW");
    expect(evaluateLeadAbuseRules(USER, { PUBLICATION_BURST: 10 }, cfg, NOW).riskLevel).toBe("ELEVATED");
  });
  it("an assessment contains no money, contact or authorization field", () => {
    const a = evaluateLeadAbuseRules(USER, { PUBLICATION_BURST: 25 }, cfg, NOW);
    expect(JSON.stringify(a)).not.toMatch(/amount|price|refund|contact|phone|email|grant|allowed/i);
  });
});

describe("M156 — mode ladder (record -> flag -> block)", () => {
  it("OFF does nothing; SHADOW only records; FLAG never blocks; ENFORCE follows the recommendation", () => {
    expect(planLeadAbuseEffect("OFF", "TEMPORARY_BLOCK")).toBe("NONE");
    expect(planLeadAbuseEffect("SHADOW", "TEMPORARY_BLOCK")).toBe("RECORD");
    expect(planLeadAbuseEffect("SHADOW", "FLAG_FOR_REVIEW")).toBe("RECORD");
    expect(planLeadAbuseEffect("FLAG", "TEMPORARY_BLOCK")).toBe("FLAG_FOR_REVIEW");
    expect(planLeadAbuseEffect("FLAG", "FLAG_FOR_REVIEW")).toBe("FLAG_FOR_REVIEW");
    expect(planLeadAbuseEffect("ENFORCE", "TEMPORARY_BLOCK")).toBe("TEMPORARY_BLOCK");
    expect(planLeadAbuseEffect("ENFORCE", "FLAG_FOR_REVIEW")).toBe("FLAG_FOR_REVIEW");
    expect(planLeadAbuseEffect("garbage" as never, "TEMPORARY_BLOCK")).toBe("NONE");
  });
});

describe("M156 — configuration overrides", () => {
  it("valid integer overrides apply; blocks keep block > flag", () => {
    const { config, warnings } = parseLeadAbuseControlConfig({
      LEAD_ABUSE_CONTROL_MODE: "FLAG",
      LEAD_ABUSE_PUBLICATION_BURST_FLAG_AT: "5",
      LEAD_ABUSE_PUBLICATION_BURST_BLOCK_AT: "8",
      LEAD_ABUSE_REPEATED_DISPUTES_LOST_FLAG_AT: "3",
    });
    expect(config.mode).toBe("FLAG");
    expect(config.thresholds.PUBLICATION_BURST).toEqual({ flagAt: 5, blockAt: 8 });
    expect(config.thresholds.REPEATED_DISPUTES_LOST.flagAt).toBe(3);
    expect(warnings).toEqual([]);
  });
  it.each(["0", "1", "-5", "abc", "1.5", "10001", "1e3", " ", "99999999"])("invalid threshold %j is ignored with a warning", (bad) => {
    const { config, warnings } = parseLeadAbuseControlConfig({ LEAD_ABUSE_PUBLICATION_BURST_FLAG_AT: bad });
    if (bad.trim() === "") return; // blank is treated as unset
    expect(config.thresholds.PUBLICATION_BURST.flagAt).toBe(LEAD_ABUSE_RULES.PUBLICATION_BURST.defaults.flagAt);
    expect(warnings.length).toBe(1);
  });
  it("a block threshold at or below the flag threshold restores both defaults", () => {
    const { config, warnings } = parseLeadAbuseControlConfig({ LEAD_ABUSE_PUBLICATION_BURST_FLAG_AT: "20", LEAD_ABUSE_PUBLICATION_BURST_BLOCK_AT: "20" });
    expect(config.thresholds.PUBLICATION_BURST).toEqual(LEAD_ABUSE_RULES.PUBLICATION_BURST.defaults);
    expect(warnings.some((w) => w.includes("PUBLICATION_BURST"))).toBe(true);
  });
  it("a block threshold cannot be set for a rule that cannot block", () => {
    const { config } = parseLeadAbuseControlConfig({ LEAD_ABUSE_REPEATED_REVOCATIONS_BLOCK_AT: "5" });
    expect(config.thresholds.REPEATED_REVOCATIONS.blockAt).toBeNull();
  });
  it("an invalid mode falls back to OFF with a warning", () => {
    const { config, warnings } = parseLeadAbuseControlConfig({ LEAD_ABUSE_CONTROL_MODE: "enforce" });
    expect(config.mode).toBe("OFF");
    expect(warnings.length).toBe(1);
  });
});

describe("M156 — idempotency keys", () => {
  it("rule keys are stable within a window bucket and change across buckets / subjects / rules", () => {
    const w = LEAD_ABUSE_RULES.PUBLICATION_BURST.windowMs;
    const k = (rule: "PUBLICATION_BURST" | "PURCHASE_INITIATION_BURST", user: string, t: Date) => ruleSignalDedupeKey(LEAD_ABUSE_RULESET_VERSION, rule, user, w, t);
    const a = k("PUBLICATION_BURST", USER, new Date("2026-10-12T10:01:00Z"));
    expect(k("PUBLICATION_BURST", USER, new Date("2026-10-12T10:59:00Z"))).toBe(a);
    expect(k("PUBLICATION_BURST", USER, new Date("2026-10-12T11:00:00Z"))).not.toBe(a);
    expect(k("PURCHASE_INITIATION_BURST", USER, new Date("2026-10-12T10:01:00Z"))).not.toBe(a);
    expect(k("PUBLICATION_BURST", "22222222-2222-4222-8222-222222222222", new Date("2026-10-12T10:01:00Z"))).not.toBe(a);
    expect(a.length).toBeLessThanOrEqual(200);
  });
  it("event keys are per user / lead / hour and case-insensitive on the lead id", () => {
    const lead = "AAAAAAAA-AAAA-4AAA-8AAA-AAAAAAAAAAAA";
    const a = eventSignalDedupeKey("CONTACT_ACCESS_DENIED_EVENT", USER, lead, NOW);
    expect(eventSignalDedupeKey("CONTACT_ACCESS_DENIED_EVENT", USER, lead.toLowerCase(), NOW)).toBe(a);
    expect(eventSignalDedupeKey("PURCHASE_REJECTED_EVENT", USER, lead, NOW)).not.toBe(a);
    expect(eventSignalDedupeKey("CONTACT_ACCESS_DENIED_EVENT", USER, lead, new Date(NOW.getTime() + 3_600_000))).not.toBe(a);
  });
});

describe("M156 — administrator input and decision state", () => {
  it("notes are trimmed, bounded and free of control characters", () => {
    expect(normalizeLeadAbuseNote("  reviewed  ")).toBe("reviewed");
    for (const bad of ["", "   ", "x".repeat(501), "a\u0000b", "a\nb", 5, null, undefined]) {
      expect(() => normalizeLeadAbuseNote(bad)).toThrow(LeadAbuseControlRejectedError);
    }
    expect(normalizeLeadAbuseNote("x".repeat(500))).toHaveLength(500);
  });
  it("administrator block duration is bounded to [30 minutes, 30 days]: there is no permanent block", () => {
    expect(normalizeAdminBlockDurationMs(MIN_BLOCK_MS)).toBe(MIN_BLOCK_MS);
    expect(normalizeAdminBlockDurationMs(MAX_ADMIN_BLOCK_MS)).toBe(MAX_ADMIN_BLOCK_MS);
    for (const bad of [0, -1, MIN_BLOCK_MS - 1, MAX_ADMIN_BLOCK_MS + 1, Infinity, NaN, 1.5, "3600000", null, undefined]) {
      expect(() => normalizeAdminBlockDurationMs(bad)).toThrow(LeadAbuseControlRejectedError);
    }
  });
  it("status moves ACTIVE -> LIFTED | EXPIRED only; terminal states are absorbing", () => {
    expect(canTransitionLeadAbuseDecision("ACTIVE", "LIFTED")).toBe(true);
    expect(canTransitionLeadAbuseDecision("ACTIVE", "EXPIRED")).toBe(true);
    for (const from of ["LIFTED", "EXPIRED"] as const) for (const to of ["ACTIVE", "LIFTED", "EXPIRED"] as const) expect(canTransitionLeadAbuseDecision(from, to)).toBe(false);
    expect(canTransitionLeadAbuseDecision("ACTIVE", "ACTIVE")).toBe(false);
  });
  it("a block is in force only while ACTIVE and unexpired; a flag never restricts", () => {
    const later = new Date(NOW.getTime() + 1000);
    expect(isBlockInForce({ action: "TEMPORARY_BLOCK", status: "ACTIVE", expiresAt: later }, NOW)).toBe(true);
    expect(isBlockInForce({ action: "TEMPORARY_BLOCK", status: "ACTIVE", expiresAt: NOW }, NOW)).toBe(false);
    expect(isBlockInForce({ action: "TEMPORARY_BLOCK", status: "ACTIVE", expiresAt: null }, NOW)).toBe(false);
    expect(isBlockInForce({ action: "TEMPORARY_BLOCK", status: "LIFTED", expiresAt: later }, NOW)).toBe(false);
    expect(isBlockInForce({ action: "FLAG_FOR_REVIEW", status: "ACTIVE", expiresAt: null }, NOW)).toBe(false);
  });
});
