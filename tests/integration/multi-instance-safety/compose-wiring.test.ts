import { describe, expect, it } from "vitest";

/**
 * Module 58 — Multi-Instance Safety Audit: end-to-end wiring coverage —
 * proving the real composition root
 * (`infrastructure/multi-instance-safety/compose.ts`) actually wires
 * every real checker together and produces a well-formed
 * `MultiInstanceSafetyReport`, not just that the pure domain/application
 * pieces work in isolation (already covered by the unit tests).
 *
 * Every checker here runs its real static analysis against this actual
 * repository checkout (via the default `SourceScanner` rooted at
 * `process.cwd()`) — no mocking, mirroring Module 57's own
 * compose-wiring test's "deliberately not mocked" convention. This test
 * does not assert specific findings (those are covered per-checker in
 * their own unit tests, and are sensitive to the exact source this
 * checkout happens to contain) — it asserts the *shape* every consumer
 * (the CLI script, a future dashboard) can rely on.
 */
describe("Module 58 — Multi-Instance Safety Audit — compose.ts wiring", () => {
  it("RunMultiInstanceSafetyAuditUseCase runs every real checker and returns a well-formed report", async () => {
    const { getRunMultiInstanceSafetyAuditUseCase } = await import("@/infrastructure/multi-instance-safety/compose");

    const report = await getRunMultiInstanceSafetyAuditUseCase().execute();

    expect(report.subsystems.length).toBe(12);
    expect(report.overallScore).toBeGreaterThanOrEqual(0);
    expect(report.overallScore).toBeLessThanOrEqual(100);
    expect(typeof report.isProductionReady).toBe("boolean");

    // No checker crashed against the real repository — every subsystem
    // produced at least one passed check or one finding, never neither.
    for (const subsystem of report.subsystems) {
      expect(subsystem.passedChecks.length + subsystem.findings.length).toBeGreaterThan(0);
    }
  });

  it("produces a report renderable as both Markdown and JSON with real content", async () => {
    const { getRunMultiInstanceSafetyAuditUseCase } = await import("@/infrastructure/multi-instance-safety/compose");
    const { renderMarkdownReport, toJsonReport } = await import("@/infrastructure/multi-instance-safety/report-generator");

    const report = await getRunMultiInstanceSafetyAuditUseCase().execute();
    const markdown = renderMarkdownReport(report);
    const json = toJsonReport(report);

    expect(markdown).toContain("# MaestroYa Multi-Instance Safety Audit");
    expect(json.subsystems.length).toBe(12);
  });

  it("returns a fresh report on every call (a computed snapshot, not a cached singleton)", async () => {
    const { getRunMultiInstanceSafetyAuditUseCase } = await import("@/infrastructure/multi-instance-safety/compose");

    const first = await getRunMultiInstanceSafetyAuditUseCase().execute();
    const second = await getRunMultiInstanceSafetyAuditUseCase().execute();

    expect(first.id).not.toBe(second.id);
    expect(first.overallScore).toBe(second.overallScore);
  });
});
