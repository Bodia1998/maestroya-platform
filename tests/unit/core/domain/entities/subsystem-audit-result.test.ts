import { describe, expect, it } from "vitest";

import { AuditFinding } from "@/domain/entities/audit-finding";
import { SubsystemAuditResult } from "@/domain/entities/subsystem-audit-result";
import { ValidationError } from "@/domain/errors/domain-error";

const subsystem = "Distributed Locking";

function finding(severity: "WARNING" | "CRITICAL", id = "f1"): AuditFinding {
  return new AuditFinding(id, subsystem, severity, "problem", "risk", "why", "impact", "fix", "HIGH");
}

describe("domain/entities/subsystem-audit-result — SubsystemAuditResult.build", () => {
  it("derives SAFE status when there are no findings", () => {
    const result = SubsystemAuditResult.build(subsystem, ["check 1 passed"], []);
    expect(result.status).toBe("SAFE");
    expect(result.warnings).toEqual([]);
    expect(result.criticalIssues).toEqual([]);
  });

  it("derives WARNING status when only warnings are present", () => {
    const result = SubsystemAuditResult.build(subsystem, [], [finding("WARNING")]);
    expect(result.status).toBe("WARNING");
    expect(result.warnings).toHaveLength(1);
    expect(result.criticalIssues).toHaveLength(0);
  });

  it("derives CRITICAL status when any critical finding is present, even alongside warnings", () => {
    const result = SubsystemAuditResult.build(subsystem, [], [finding("WARNING", "f1"), finding("CRITICAL", "f2")]);
    expect(result.status).toBe("CRITICAL");
    expect(result.warnings).toHaveLength(1);
    expect(result.criticalIssues).toHaveLength(1);
  });

  it("rejects an empty subsystem name", () => {
    expect(() => SubsystemAuditResult.build("  ", [], [])).toThrow(ValidationError);
  });

  it("rejects a finding whose subsystem does not match", () => {
    const mismatched = new AuditFinding("f1", "Some Other Subsystem", "WARNING", "p", "r", "w", "i", "fix", "LOW");
    expect(() => SubsystemAuditResult.build(subsystem, [], [mismatched])).toThrow(ValidationError);
  });
});
