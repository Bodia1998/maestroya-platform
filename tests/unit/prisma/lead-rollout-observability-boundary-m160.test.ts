import { readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

/**
 * Module 160 - static contract of the rollout observability:
 *  (1) the only new operational surfaces are the guard's block event and the boot-time effective-mode line, both built from fixed
 *      low-cardinality fields and neither able to read or print a raw configuration value;
 *  (2) no new environment variable, state, dependency or module was introduced;
 *  (3) the runbook names only events, variables, routes and modes that exist in the code.
 */
const root = path.resolve(__dirname, "../../..");
const read = (f: string) => readFileSync(path.join(root, f), "utf8");
const code = (f: string) => read(f).replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
function walk(dir: string): string[] {
  return readdirSync(dir).flatMap((n) => {
    const p = path.join(dir, n);
    return statSync(p).isDirectory() ? walk(p) : [p];
  });
}
const SRC_FILES = walk(path.join(root, "src")).filter((f) => /\.(ts|tsx)$/.test(f));
const ALL_SOURCE = [...SRC_FILES.map((f) => readFileSync(f, "utf8")), read("instrumentation.ts")].join("\n");

const GUARD = "src/core/application/use-cases/lead-rollout/lead-rollout-guard.ts";
const RUNBOOK = "docs/MODULE_160_OBSERVABILITY_RUNBOOKS.md";

describe("M160 - guard block event and boot line are value-free", () => {
  const guard = code(GUARD);

  it("the guard emits exactly one event name, with exactly the four fixed fields", () => {
    expect(guard.match(/logger\.(?:info|warn|error|debug)\(\s*"([^"]+)"/g)).toEqual(['logger.info("lead_rollout.guard_blocked"', 'logger.error("lead_rollout.guard_blocked"']);
    expect(guard).toContain("const fields = { area, mode, configStatus, reason };");
  });

  it("the guard's logging code never touches the call arguments, the environment or an error object", () => {
    const recorder = guard.slice(guard.indexOf("function recordGuardBlocked"));
    expect(recorder).not.toMatch(/process\.env|\.\.\.args|args\b|(?<!logger\.)\berror\b|\.message|\.stack|JSON\.stringify/);
    expect(guard).not.toMatch(/process\.env/);
  });

  it("a logging failure is swallowed inside the recorder, which is called before the unchanged refusal", () => {
    const recorder = guard.slice(guard.indexOf("function recordGuardBlocked"));
    expect(recorder).toMatch(/try\s*\{[\s\S]*\}\s*catch\s*\{/);
    expect(guard).toMatch(/recordGuardBlocked\(area, config, readerFailed\);\s*throw new LeadV1RolloutDisabledError\(\);/);
  });

  it("the boot line is best-effort, reuses the M159 loader and logs only the described view", () => {
    const boot = code("instrumentation.ts");
    const start = boot.indexOf('"@/infrastructure/config/lead-rollout-config"');
    expect(start).toBeGreaterThan(-1);
    const block = boot.slice(boot.lastIndexOf("try {", start), boot.indexOf("} catch", start) + 20);
    expect(block).toContain("loadLeadRolloutConfig()");
    expect(block).toContain("describeLeadRollout(");
    expect(block).toContain('logger.info("lead_rollout.effective_mode", {');
    expect(block).not.toMatch(/process\.env|LEAD_V1_ROLLOUT_MODE/);
    expect(block).toMatch(/mode: rollout\.mode,\s*configStatus: rollout\.status,\s*entryOpen: rollout\.entryOpen,\s*purchaseOpen: rollout\.purchaseOpen,/);
  });
});

describe("M160 - nothing new that could drift from M159", () => {
  it("LEAD_V1_ROLLOUT_MODE is still read in exactly one source file, the M159 loader", () => {
    const readers = SRC_FILES.filter((f) => /LEAD_V1_ROLLOUT_MODE|LEAD_ROLLOUT_MODE_ENV/.test(code(path.relative(root, f)))).map((f) => path.relative(root, f).split(path.sep).join("/"));
    expect(readers.sort()).toEqual(["src/core/domain/services/lead-rollout.ts", "src/core/infrastructure/config/lead-rollout-config.ts"]);
    expect(code("instrumentation.ts")).not.toMatch(/LEAD_V1_ROLLOUT_MODE|LEAD_ROLLOUT_MODE_ENV/);
  });

  it("M160 adds no environment variable, schema change, migration or dependency", () => {
    // Boolean-only assertions: file content must never end up in a failure message.
    expect(/Module 160|\bM160\b/i.test(read("prisma/schema.prisma"))).toBe(false);
    expect(walk(path.join(root, "prisma/migrations")).filter((m) => /m160|module[_-]?160|observab/i.test(m))).toEqual([]);
    const pkg = read("package.json");
    expect(/prom-client|statsd|datadog|pagerduty|opsgenie|pino|winston/i.test(pkg)).toBe(false);
    expect(/M160|Module 160|ROLLOUT_ALERT/.test(read(".env.example"))).toBe(false);
  });
});

describe("M160 - the runbook matches the code", () => {
  const doc = read(RUNBOOK);

  it("every event name the runbook cites exists in the source", () => {
    const events = new Set(
      [...doc.matchAll(/`((?:lead_rollout|lead_fee_payment|lead_fee_payment_webhook|lead_fee_dispute_webhook|lead_privacy_retention|lead_privacy_retention_cron|stripe_payments_webhook|lead_contact_access|lead_abuse)[A-Za-z0-9_.]*)`/g)].map((m) => m[1]!),
    );
    expect(events.size).toBeGreaterThan(10);
    for (const event of events) {
      if (event.endsWith(".*") || event.endsWith("_")) continue;
      const needle = event.startsWith("lead_abuse.") ? "lead_abuse." : event;
      expect(ALL_SOURCE.includes(needle), `event ${event} is cited in the runbook but not present in the source`).toBe(true);
    }
  });

  it("every fixed reason, mode, status and area value cited is the one the code defines", () => {
    for (const mode of ["DISABLED", "ENTRY_ONLY", "PURCHASE_ONLY", "ENABLED"]) expect(doc).toContain(`\`${mode}\``);
    for (const reason of ["AREA_CLOSED", "CONFIG_READER_FAILED", "CONFIG_MALFORMED"]) {
      expect(doc).toContain(reason);
      expect(code(GUARD)).toContain(reason);
    }
    for (const status of ["DEFAULT", "CONFIGURED", "MISCONFIGURED"]) expect(code("src/core/domain/services/lead-rollout.ts")).toContain(status);
  });

  it("the cited routes, cron schedule and webhook outcomes exist", () => {
    expect(read("vercel.json")).toContain('"/api/cron/lead-privacy-retention"');
    expect(read("vercel.json")).toContain('"20 4 * * *"');
    for (const route of ["api/health/ready/route.ts", "api/health/startup/route.ts", "api/health/diagnostics/route.ts", "api/health/circuit-breakers/route.ts", "api/health/route.ts", "api/cron/lead-privacy-retention/route.ts"]) {
      expect(() => read(`src/app/${route}`), route).not.toThrow();
    }
    const webhook = code("src/core/application/use-cases/lead-fee-payment/process-lead-fee-payment-webhook.use-case.ts");
    for (const outcome of ["confirmed", "already-confirmed", "cancelled", "payment-failed-observed", "duplicate", "unmatched", "rejected", "ignored"]) expect(webhook).toContain(`"${outcome}"`);
    for (const phase of ["ERASED_CUSTOMER_REQUESTS", "TERMINAL_REQUEST_MINIMIZATION", "ROLLOUT_REPORT", "AUDIT"]) {
      expect(code("src/core/application/use-cases/lead-privacy/run-lead-privacy-retention.use-case.ts")).toContain(phase);
    }
  });

  it("the runbook does not invent recovery tooling or thresholds for PENDING_PAYMENT, and says so", () => {
    expect(doc).toMatch(/No automatic expiry, no timeout job, no operator command or admin action/);
    expect(doc).toMatch(/requires baseline data/);
    expect(doc).not.toMatch(/npm run [a-z:-]*pending|expire-pending|cancel-pending/i);
  });

  it("the runbook contains no secret, URL with credentials, connection string or real-looking identifier", () => {
    expect(doc).not.toMatch(/postgres(ql)?:\/\//i);
    expect(doc).not.toMatch(/sk_(live|test)_|whsec_|re_[A-Za-z0-9]{8,}|eyJ[A-Za-z0-9_-]{10,}/);
    expect(doc).not.toMatch(/[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[a-z]{2,}/);
    expect(doc).not.toMatch(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i);
  });

  it("the runbook covers its fifteen mandatory sections and states that Gate B / D21 are not decided here", () => {
    for (let i = 1; i <= 15; i++) expect(doc, `section ${i}`).toMatch(new RegExp(`^## ${i}\\. `, "m"));
    expect(doc).toContain("D21");
    expect(doc).toMatch(/does not enable LEAD_V1, does not pass Gate B/);
  });
});
