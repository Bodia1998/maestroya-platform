import { describe, expect, it } from "vitest";

import { AuditFinding } from "@/domain/entities/audit-finding";
import { ValidationError } from "@/domain/errors/domain-error";

function makeFinding(overrides: Partial<Record<string, string>> = {}): AuditFinding {
  return new AuditFinding(
    overrides.id ?? "finding-1",
    overrides.subsystem ?? "Caching",
    "WARNING",
    overrides.problem ?? "Cache is not shared.",
    overrides.risk ?? "Stale reads.",
    overrides.whyItHappens ?? "No Redis configured.",
    overrides.impact ?? "Inconsistent reads across instances.",
    overrides.recommendedFix ?? "Configure REDIS_URL.",
    "MEDIUM",
  );
}

describe("domain/entities/audit-finding — AuditFinding", () => {
  it("constructs with all required fields", () => {
    const finding = makeFinding();
    expect(finding.id).toBe("finding-1");
    expect(finding.subsystem).toBe("Caching");
    expect(finding.severity).toBe("WARNING");
    expect(finding.priority).toBe("MEDIUM");
    expect(finding.evidence).toEqual([]);
  });

  it("defaults evidence to an empty array when omitted", () => {
    const finding = makeFinding();
    expect(finding.evidence).toEqual([]);
  });

  it("accepts explicit evidence", () => {
    const finding = new AuditFinding(
      "f2",
      "Locking",
      "CRITICAL",
      "problem",
      "risk",
      "why",
      "impact",
      "fix",
      "CRITICAL",
      ["src/a.ts", "src/b.ts"],
    );
    expect(finding.evidence).toEqual(["src/a.ts", "src/b.ts"]);
  });

  it.each(["id", "subsystem", "problem", "risk", "whyItHappens", "impact", "recommendedFix"])(
    "rejects an empty %s",
    (field) => {
      expect(() => makeFinding({ [field]: "   " })).toThrow(ValidationError);
    },
  );
});
