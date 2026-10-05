import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

const root = path.resolve(__dirname, "../../..");
const read = (f: string) => readFileSync(path.join(root, f), "utf8");
const strip = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");

describe("Module 130 — lead lifecycle boundaries", () => {
  const leadRepo = "src/core/infrastructure/database/prisma/repositories/prisma-lead-repository.ts";
  const requestRepo = "src/core/infrastructure/database/prisma/repositories/prisma-service-request-repository.ts";

  it("the lead write stays in PrismaLeadRepository; the request repository only calls its propagation helper", () => {
    expect(strip(read(requestRepo))).not.toMatch(/\blead\.(create|update|updateMany|upsert|delete|deleteMany)\(/);
    expect(strip(read(requestRepo))).toContain("propagateServiceRequestStatusToLead(tx");
  });

  it("propagation is LEAD_V1-scoped, status-conditional and never touches purchases or legacy money models", () => {
    const src = strip(read(leadRepo));
    const fn = src.slice(src.indexOf("export async function propagateServiceRequestStatusToLead"));
    expect(fn).toContain("LEAD_FLOW_VERSION");
    expect(fn).toContain("leadStatusesThatMayTransitionTo");
    expect(fn).not.toMatch(/leadPurchase|quote|payment|commission|payout|invoice/i);
  });

  it("no cancel/expire use case duplicates lead lifecycle logic (they only use the central updateStatus)", () => {
    for (const f of [
      "src/core/application/use-cases/service-request/cancel-service-request.use-case.ts",
      "src/core/application/use-cases/workflow-expiration/expire-service-requests.use-case.ts",
    ]) {
      expect(strip(read(f)), f).not.toMatch(/LeadRepository|leads\./);
    }
  });

  it("Module 130 adds no schema change and no Prisma migration (stale-lead backfill is an optional ops script under docs/)", () => {
    const migrations = readdirSync(path.join(root, "prisma/migrations")).filter((d) => d !== "migration_lock.toml");
    expect(migrations.some((d) => d.includes("module_130"))).toBe(false);
    const sql = strip(read("docs/MODULE_130_STALE_LEAD_BACKFILL.sql").replace(/^--.*$/gm, ""));
    expect(sql).not.toMatch(/\b(DROP|DELETE|TRUNCATE|ALTER|CREATE|INSERT)\b/i);
    expect([...sql.matchAll(/UPDATE\s+"([^"]+)"/gi)].map((m) => m[1])).toEqual(["leads"]);
    expect(sql).toContain("'LEAD_V1'");
    expect(sql).not.toMatch(/lead_purchases/);
  });
});
