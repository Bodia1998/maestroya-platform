import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

import { LEAD_REGIONAL_CALIBRATION_V1 } from "@/infrastructure/pricing/lead-regional-calibration.v1";
import { DEFAULT_LEAD_REGIONAL_PRICING_MODE } from "@/domain/services/lead-regional-pricing-mode";
import { DEFAULT_TRANSACTION_FLOW_VERSION } from "@/domain/services/transaction-flow";

/**
 * Module 165 - static contract of the LEAD_V1 default cutover:
 *  (1) EVERY place that gives a new ServiceRequest its flow version is known and accounted for;
 *  (2) the cutover adds no second rollout switch, no schema change, no migration and no write path;
 *  (3) the persisted flow remains the only source of truth (no default is read at use time);
 *  (4) the cutover is separate from M164 pricing: it reads and enables nothing there.
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
const rel = (p: string) => path.relative(root, p).split(path.sep).join("/");
const SRC = walk(path.join(root, "src")).map(rel).filter((f) => /\.(ts|tsx)$/.test(f));
const UC = "src/core/application/use-cases/";

const M165_FILES = [
  "src/core/domain/services/new-request-flow.ts",
  `${UC}new-request-flow/new-request-flow-selector.ts`,
  `${UC}new-request-flow/legacy-request-creation-guard.ts`,
  `${UC}new-request-flow/compose.ts`,
];

describe("M165 - every ServiceRequest creation entry point is accounted for", () => {
  it("only PrismaServiceRequestRepository writes a service_requests row", () => {
    const writers = SRC.filter((f) => /\bprisma\.serviceRequest\.(create|createMany|upsert)\(/.test(code(f)));
    expect(writers).toEqual(["src/core/infrastructure/database/prisma/repositories/prisma-service-request-repository.ts"]);
  });

  it("the repository callers of ServiceRequestRepository.create are exactly the legacy and the LEAD_V1 use cases", () => {
    const callers = SRC.filter((f) => /serviceRequests\.create\(/.test(code(f)));
    expect(callers.sort()).toEqual([`${UC}lead/create-lead-v1-service-request.use-case.ts`, `${UC}service-request/create-service-request.use-case.ts`].sort());
  });

  it("the legacy use case never passes a flow (it stays the repository default) and the LEAD_V1 use case always passes the literal LEAD_FLOW_VERSION", () => {
    expect(code(`${UC}service-request/create-service-request.use-case.ts`)).not.toMatch(/flowVersion/);
    expect(code(`${UC}lead/create-lead-v1-service-request.use-case.ts`)).toMatch(/flowVersion:\s*LEAD_FLOW_VERSION/);
  });

  it("the legacy use case is constructed in exactly one production file, behind the cutover guard", () => {
    const constructors = SRC.filter((f) => /new CreateServiceRequestUseCase\(/.test(code(f)));
    expect(constructors).toEqual([`${UC}service-request/compose.ts`]);
    const compose = code(`${UC}service-request/compose.ts`);
    const start = compose.indexOf("export function makeCreateServiceRequestUseCase(");
    const body = compose.slice(start, compose.indexOf("\nexport ", start + 10));
    expect(body.match(/\breturn\b/g)).toHaveLength(1);
    expect(body).toMatch(/return\s+new LegacyRequestCreationGuarded\(/);
    expect(body).toContain("new CreateServiceRequestUseCase(");
  });

  it("src/app (actions, pages, routes) never constructs a creation use case or the guard", () => {
    for (const file of SRC.filter((f) => f.startsWith("src/app/"))) {
      expect(code(file), file).not.toMatch(/new (CreateServiceRequestUseCase|CreateLeadV1ServiceRequestUseCase|SubmitLeadRequestUseCase|LegacyRequestCreationGuarded|NewRequestFlowSelector)\(/);
    }
  });

  it("the only server actions that create a request go through the production factories", () => {
    expect(code("src/app/(dashboard)/requests/actions.ts")).toContain("makeCreateServiceRequestUseCase().execute(");
    expect(code("src/app/(dashboard)/requests/lead-actions.ts")).toContain("makeCreateLeadV1ServiceRequestUseCase().execute(");
    expect(code("src/app/(dashboard)/requests/new/lead/actions.ts")).toContain("makeSubmitLeadRequestUseCase().execute(");
  });

  it("the /requests/new page asks the selector (it does not decide the flow itself) and the form actions pass no flow from the client", () => {
    const page = code("src/app/(dashboard)/requests/new/page.tsx");
    expect(page).toContain("makeNewRequestFlowSelector()");
    expect(page).toMatch(/redirect\("\/requests\/new\/lead"\)/);
    for (const f of ["src/app/(dashboard)/requests/actions.ts", "src/app/(dashboard)/requests/lead-actions.ts", "src/app/(dashboard)/requests/new/lead/actions.ts"]) {
      expect(code(f), f).not.toMatch(/flowVersion/);
    }
  });
});

describe("M165 - no second source of truth, no schema change, no second switch", () => {
  it("the default flow constant, the repository fallback and the database default are all still LEGACY_QUOTE_PAYMENT (history is never reclassified)", () => {
    expect(DEFAULT_TRANSACTION_FLOW_VERSION).toBe("LEGACY_QUOTE_PAYMENT");
    expect(read("prisma/schema.prisma")).toMatch(/flowVersion\s+TransactionFlowVersion\s+@default\(LEGACY_QUOTE_PAYMENT\)/);
    expect(code("src/core/infrastructure/database/prisma/repositories/prisma-service-request-repository.ts")).toContain("data.flowVersion ?? DEFAULT_TRANSACTION_FLOW_VERSION");
  });

  it("nothing outside the creation use cases and the repository consumes the DEFAULT constant (no later operation infers the flow from a default)", () => {
    const users = SRC.filter((f) => /DEFAULT_TRANSACTION_FLOW_VERSION/.test(code(f)));
    expect(users.sort()).toEqual(
      [
        "src/core/domain/services/new-request-flow.ts",
        "src/core/domain/services/transaction-flow.ts",
        "src/core/infrastructure/database/prisma/repositories/prisma-service-request-repository.ts",
      ].sort(),
    );
  });

  it("adds no migration, no schema text and no persisted state", () => {
    const migrations = walk(path.join(root, "prisma/migrations")).map(rel);
    expect(migrations.filter((m) => /165|cutover|new_request_flow/i.test(m))).toEqual([]);
    expect(read("prisma/schema.prisma")).not.toMatch(/cutover|NewRequestFlow/i);
  });

  it("introduces no environment variable and no second rollout mechanism: the only rollout read is the M159 status", () => {
    for (const f of M165_FILES) {
      const c = code(f);
      expect(c, f).not.toMatch(/process\.env|\benv\./);
      expect(c, f).not.toMatch(/feature-flags|FEATURE_FLAGS|isFeatureEnabled/);
      expect(c, f).not.toMatch(/loadLeadRolloutConfig|LEAD_V1_ROLLOUT_MODE/);
    }
    expect(code(`${UC}new-request-flow/compose.ts`)).toContain("getLeadRolloutStatus()");
  });

  it("the cutover only READS: no repository write, no Prisma, no create/update/delete call in any M165 file", () => {
    for (const f of M165_FILES) {
      const c = code(f);
      expect(c, f).not.toMatch(/\.(create|update|updateStatus|delete|upsert|save)\(/);
      expect(c, f).not.toMatch(/@prisma|prisma\./);
    }
  });

  it("the legacy-flow guard (M121/M131) and the flow reader do not depend on the cutover: isolation holds in every configuration", () => {
    for (const f of SRC.filter((s) => /transaction-flow-guard|transaction-flow-reader|legacy-flow|prisma-legacy-flow/.test(s))) {
      expect(code(f), f).not.toMatch(/new-request-flow|NewRequestFlow|LegacyRequestCreation/);
    }
  });

  it("only the creation path consumes the selector: publication, pricing, purchase, contact and payment code never import it", () => {
    const users = SRC.filter((f) => !M165_FILES.includes(f) && /new-request-flow/.test(code(f)));
    expect(users.sort()).toEqual([`${UC}service-request/compose.ts`, "src/app/(dashboard)/requests/new/page.tsx"].sort());
  });
});

describe("M165 - separate from M164 regional pricing", () => {
  it("no M165 file reads or sets any regional-pricing / calibration / pricing-config switch", () => {
    for (const f of M165_FILES) {
      expect(code(f), f).not.toMatch(/LEAD_REGIONAL|regional-pricing|regional-calibration|LEAD_PRICING_CONFIG_VERSION|lead-pricing-review/);
    }
  });

  it("the regional pricing mode still defaults to OFF and the shipped calibration release still has NO enabled entry", () => {
    expect(DEFAULT_LEAD_REGIONAL_PRICING_MODE).toBe("OFF");
    expect(LEAD_REGIONAL_CALIBRATION_V1.entries).toEqual([]);
    expect(LEAD_REGIONAL_CALIBRATION_V1.supplyMultiplier).toEqual({ status: "DISABLED" });
  });

  it("no environment file enables regional pricing or the cutover", () => {
    for (const file of [".env.example", ".env.test", ".env.production", "docker-compose.prod.yml", "vercel.json"]) {
      if (!existsSync(path.join(root, file))) continue;
      const text = read(file);
      // Boolean-only assertions: an environment file's content must never end up in a failure message.
      const regionalOn = /^\s*LEAD_REGIONAL_PRICING_MODE\s*[=:]\s*["']?(SHADOW|ENFORCE)/m.test(text);
      expect(regionalOn, `${file} must not enable regional pricing`).toBe(false);
    }
  });
});
