import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { IdempotencyChecker } from "@/infrastructure/multi-instance-safety/checkers/idempotency-checker";
import { SourceScanner } from "@/infrastructure/multi-instance-safety/source-scanner";

describe("infrastructure/multi-instance-safety/checkers/idempotency-checker — IdempotencyChecker", () => {
  let dir: string;

  beforeEach(async () => {
    dir = await mkdtemp(path.join(tmpdir(), "m58-idempotency-checker-"));
  });

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it("flags the absence of a Stripe webhook route as a forward-looking WARNING, not a CRITICAL", async () => {
    const checker = new IdempotencyChecker(new SourceScanner(dir), async () => false);
    const outcome = await checker.check();

    const webhookFinding = outcome.findings.find((f) => f.problem.includes("Stripe webhook"));
    expect(webhookFinding).toBeDefined();
    expect(webhookFinding!.severity).toBe("WARNING");
  });

  it("records a passed check instead of a finding when a Stripe webhook route does exist", async () => {
    const checker = new IdempotencyChecker(new SourceScanner(dir), async () => true);
    const outcome = await checker.check();

    expect(outcome.findings.some((f) => f.problem.includes("Stripe webhook"))).toBe(false);
    expect(outcome.passedChecks.some((c) => c.includes("Stripe webhook"))).toBe(true);
  });

  it("reports CRITICAL findings for missing job-idempotency-store/ledger idempotency evidence in an empty fixture repo", async () => {
    const checker = new IdempotencyChecker(new SourceScanner(dir), async () => false);
    const outcome = await checker.check();

    expect(outcome.findings.filter((f) => f.severity === "CRITICAL").length).toBeGreaterThanOrEqual(2);
  });
});
