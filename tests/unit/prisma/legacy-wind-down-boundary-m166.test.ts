import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

import {
  LEGACY_CAPTURED_PAYMENT_STATUSES,
  LEGACY_OPEN_ADJUSTMENT_STATUSES,
  LEGACY_OPEN_AFFILIATE_COMMISSION_STATUSES,
  LEGACY_OPEN_COMPLETION_STATUSES,
  LEGACY_OPEN_CREDIT_NOTE_STATUSES,
  LEGACY_OPEN_DECISION_STATUSES,
  LEGACY_OPEN_DISPUTE_STATUSES,
  LEGACY_OPEN_JOB_STATUSES,
  LEGACY_OPEN_PAYOUT_STATUSES,
  LEGACY_OPEN_QUOTE_STATUSES,
  LEGACY_OPEN_RECEIPT_INVOICE_STATUSES,
  LEGACY_OPEN_REFUND_STATUSES,
  LEGACY_OPEN_RELEASE_STATUSES,
  LEGACY_OPEN_REQUEST_STATUSES,
  LEGACY_OPEN_SELF_BILLED_INVOICE_STATUSES,
  LEGACY_OPEN_STRIPE_DISPUTE_STATUSES,
  LEGACY_UNCONFIRMED_PAYMENT_STATUSES,
  LEGACY_UNSETTLED_WEBHOOK_STATUSES,
} from "@/domain/services/legacy-wind-down";

/**
 * Module 166 — static contract. The wind-down is a READ-ONLY inventory: it queries only, adds no schema / migration / environment
 * variable / feature flag / second cutover switch, is wired to no route / action / webhook / cron, changes none of the legacy
 * money paths, and uses status vocabulary that exists in the schema and in the repository's own state machines.
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
const SCRIPTS = walk(path.join(root, "scripts")).map(rel).filter((f) => /\.(ts|tsx|cjs|mjs)$/.test(f));

const DOMAIN = "src/core/domain/services/legacy-wind-down.ts";
const PORT = "src/core/domain/repositories/legacy-wind-down-reader.ts";
const READER = "src/core/infrastructure/database/prisma/repositories/prisma-legacy-wind-down-reader.ts";
const USE_CASE = "src/core/application/use-cases/legacy-wind-down/generate-legacy-wind-down-report.use-case.ts";
const COMPOSE = "src/core/application/use-cases/legacy-wind-down/compose.ts";
const SCRIPT = "scripts/run-legacy-wind-down-report.ts";
const M166_SRC = [DOMAIN, PORT, READER, USE_CASE, COMPOSE];
const DOC = "docs/MODULE_166_LEGACY_WIND_DOWN_FINAL_SETTLEMENT.md";

const mentionsM166 = (f: string) => /legacy-wind-down|LegacyWindDown|GenerateLegacyWindDownReport|legacy_wind_down/.test(code(f));

describe("M166 — read-only boundary", () => {
  it("the whole M166 source surface is exactly these five files (+ the operator script)", () => {
    expect(SRC.filter(mentionsM166).sort()).toEqual([...M166_SRC].sort());
    expect(SCRIPTS.filter(mentionsM166)).toEqual([SCRIPT]);
  });

  it("the port is query-only: one method, no write verbs", () => {
    const src = code(PORT);
    expect(src.match(/^\s+\w+\(.*\): Promise</gm)).toHaveLength(1);
    expect(src).toMatch(/readSnapshot\(\): Promise<LegacyWindDownSnapshot>/);
    expect(src).not.toMatch(/\b(create|update|delete|upsert|save|issue|record|resolve|repair|fix|mark|persist|write|settle|refund|pay)\w*\(/i);
  });

  it("the Prisma adapter only reads: findMany/findFirst/count/aggregate, one READ ONLY transaction, no writes, no other raw SQL", () => {
    const src = code(READER);
    expect(src).not.toMatch(/\.(create|createMany|update|updateMany|delete|deleteMany|upsert)\b/);
    expect(src).not.toMatch(/\$queryRaw|\$executeRaw\b|\$executeRawUnsafe\(\s*[^"\s]|TRUNCATE|INSERT|DELETE FROM|UPDATE\s+"/);
    expect(src.match(/\$executeRawUnsafe\(/g)).toHaveLength(1);
    expect(src).toMatch(/\$executeRawUnsafe\("SET TRANSACTION READ ONLY"\)/);
    expect(src).toMatch(/TransactionIsolationLevel\.RepeatableRead/);
    // Every Prisma delegate call in the adapter is one of the four read methods.
    const calls = [...src.matchAll(/\btx\.\w+\.(\w+)\(/g)].map((m) => m[1]);
    expect(calls.length).toBeGreaterThan(20);
    for (const c of calls) expect(["findMany", "findFirst", "count", "aggregate"]).toContain(c);
  });

  it("the adapter never selects party data or free text", () => {
    const src = code(READER);
    for (const forbidden of ["recipientLegalName", "recipientTaxId", "issuerLegalName", "issuerTaxId", "notes:", "description:", "title:", "cancellationNote", "address", "email"]) {
      expect(src, forbidden).not.toContain(forbidden);
    }
    expect(src).not.toMatch(/\binclude:/);
  });

  it("the use case holds only the reader and a clock — it cannot settle, refund, pay, resolve or issue anything", () => {
    const src = code(USE_CASE);
    expect(src).toMatch(/private readonly reader: LegacyWindDownReader/);
    expect(src).not.toMatch(/Repository|Gateway|EventBus|Notification|AuditLog|publishDomainEvent|logger/);
    expect(src).not.toMatch(/\b(refund|payout|capture|release|issue|resolve|cancel)\w*\(/i);
  });

  it("the composition root is used only by the operator script: no route, Server Action, webhook, cron, queue or scheduler", () => {
    const users = [...SRC, ...SCRIPTS].filter((f) => f !== COMPOSE && /makeGenerateLegacyWindDownReportUseCase/.test(code(f)));
    expect(users).toEqual([SCRIPT]);
    for (const f of SRC.filter((f) => f.startsWith("src/app/"))) expect(mentionsM166(f), f).toBe(false);
    const vercel = JSON.parse(read("vercel.json")) as { crons: { path: string }[] };
    for (const c of vercel.crons) expect(c.path).not.toMatch(/wind|legacy|settle/i);
  });

  it("the script writes no file, fails closed (exit 2) and never prints a report on failure", () => {
    const src = code(SCRIPT);
    expect(src).not.toMatch(/writeFile|appendFile|mkdir|fs\.|createWriteStream|rmSync|unlink/);
    expect(src).toMatch(/fail closed/i);
    expect(src).toMatch(/return 2;/);
    expect(src).toMatch(/process\.exit\(code\)/);
    // The verdict printed by the script comes only from the use case; the script has no verdict logic of its own.
    expect(src).not.toMatch(/Gate C (passed|approved)/i);
  });
});

describe("M166 — no schema, migration, environment variable, feature flag or second cutover switch", () => {
  it("adds nothing to the Prisma schema or the migrations", () => {
    expect(read("prisma/schema.prisma")).not.toMatch(/wind_?down|WindDown/i);
    const migrations = readdirSync(path.join(root, "prisma/migrations"));
    expect(migrations.filter((m) => /166|wind[-_]?down/i.test(m))).toEqual([]);
  });

  it("reads no environment variable and adds none", () => {
    for (const f of [...M166_SRC, SCRIPT]) {
      expect(code(f), f).not.toMatch(/process\.env|import\.meta\.env|@\/infrastructure\/config/);
    }
    expect(read(".env.example")).not.toMatch(/WIND_DOWN/i);
    expect(read("src/core/infrastructure/config/env.ts")).not.toMatch(/WIND_DOWN/i);
  });

  it("introduces no feature flag and does not touch the M159 / M165 controls (no second switch)", () => {
    for (const f of M166_SRC) {
      expect(code(f), f).not.toMatch(/feature-flag|lead-rollout|new-request-flow|LEAD_V1_ROLLOUT_MODE|getLeadRolloutStatus|selectNewRequestFlow/i);
    }
  });

  it("changes no legacy money path: no legacy use case, webhook route or cron route mentions M166", () => {
    for (const f of SRC.filter((f) => /use-cases\/(quotes|payments|refunds|stripe-disputes|financial|job|invoicing|workflow-expiration|reconciliation|affiliate|dispute|service-request)\//.test(f) || f.startsWith("src/app/api/"))) {
      expect(mentionsM166(f), f).toBe(false);
    }
  });

  it("keeps in-flight legacy processing alive: the legacy webhook routes and the closing crons still exist and are still scheduled", () => {
    for (const f of ["src/app/api/webhooks/stripe-payments/route.ts", "src/app/api/webhooks/stripe/route.ts", "src/app/api/cron/expire-workflows/route.ts", "src/app/api/cron/reconciliation-run/route.ts"]) {
      expect(existsSync(path.join(root, f)), f).toBe(true);
    }
    const paths = (JSON.parse(read("vercel.json")) as { crons: { path: string }[] }).crons.map((c) => c.path);
    expect(paths).toEqual(expect.arrayContaining(["/api/cron/expire-workflows", "/api/cron/reconciliation-run"]));
  });

  it("the M121 flow boundary and the M131 mandatory guard are untouched by the wind-down", () => {
    const guard = read("src/core/application/services/flow/transaction-flow-guard.ts");
    expect(guard).toMatch(/requireLegacyFlowGuard/);
    expect(guard).toMatch(/LegacyFlowBoundaryError/);
    for (const f of M166_SRC) expect(code(f), f).not.toMatch(/TransactionFlowGuard|assertLegacy|shouldRunLegacyFlow|flowVersion:\s*"LEAD_V1"/);
    // Reclassification is impossible by construction: the reader never writes, and filters on the stored flow only.
    expect(code(READER)).not.toMatch(/flowVersion\s*:\s*"LEAD_V1"/);
  });
});

describe("M166 — the verified facts the wind-down rules rely on", () => {
  it("CommissionRepository has no status-mutating method, so a legacy commission can never leave PENDING (hence it is not an inventory object)", () => {
    const src = code("src/core/domain/repositories/commission-repository.ts");
    const methods = [...src.matchAll(/^\s+(\w+)\(/gm)].map((m) => m[1]);
    expect(methods.sort()).toEqual(["create", "findById", "findByPaymentId", "listForCompany", "listForProfessional"]);
    // The snapshot has no plain "commissions" collection (affiliate commissions are a different, derived object).
    expect(code(DOMAIN)).not.toMatch(/(^|\s)commissions?\s*:/im);
  });

  it("no code moves a legacy ServiceRequest to QUOTED / IN_PROGRESS / COMPLETED, so ACCEPTED is a resting state governed by its Job", () => {
    for (const f of SRC) {
      expect(code(f), f).not.toMatch(/serviceRequests?\.updateStatus\([^)]*"(QUOTED|IN_PROGRESS|COMPLETED)"/);
    }
    // The only writer of ACCEPTED is the quote-acceptance transaction, restricted to the legacy flow.
    expect(code("src/core/infrastructure/database/prisma/repositories/prisma-quote-acceptance-repository.ts")).toMatch(/flowVersion: "LEGACY_QUOTE_PAYMENT"/);
  });

  it("a Stripe dispute can be closed LOST without a financial adjustment (the case the report flags)", () => {
    expect(code("src/core/application/use-cases/stripe-disputes/process-stripe-dispute-webhook.use-case.ts")).toMatch(/markClosed\(\{ id: existing!\.id, status: "LOST", financialAdjustmentId: null \}\)/);
  });

  it("every status the rules use exists in the matching Prisma enum", () => {
    const schema = read("prisma/schema.prisma");
    const enumValues = (name: string): string[] => {
      const m = new RegExp(`enum ${name} \\{([^}]*)\\}`).exec(schema);
      expect(m, `enum ${name}`).not.toBeNull();
      return (m![1] ?? "")
        .split("\n")
        .map((l) => l.replace(/\/\/.*$/, "").trim())
        .filter((l) => /^[A-Z_]+$/.test(l));
    };
    const pairs: Array<[string, readonly string[]]> = [
      ["ServiceRequestStatus", LEGACY_OPEN_REQUEST_STATUSES],
      ["QuoteStatus", LEGACY_OPEN_QUOTE_STATUSES],
      ["JobStatus", LEGACY_OPEN_JOB_STATUSES],
      ["JobCompletionConfirmationStatus", LEGACY_OPEN_COMPLETION_STATUSES],
      ["PaymentReleaseStatus", LEGACY_OPEN_RELEASE_STATUSES],
      ["PaymentStatus", [...LEGACY_UNCONFIRMED_PAYMENT_STATUSES, ...LEGACY_CAPTURED_PAYMENT_STATUSES]],
      ["PayoutStatus", LEGACY_OPEN_PAYOUT_STATUSES],
      ["RefundStatus", LEGACY_OPEN_REFUND_STATUSES],
      ["FinancialAdjustmentStatus", LEGACY_OPEN_ADJUSTMENT_STATUSES],
      ["DisputeResolutionDecisionStatus", LEGACY_OPEN_DECISION_STATUSES],
      ["DisputeStatus", LEGACY_OPEN_DISPUTE_STATUSES],
      ["StripeDisputeStatus", LEGACY_OPEN_STRIPE_DISPUTE_STATUSES],
      ["InvoiceStatus", [...LEGACY_OPEN_SELF_BILLED_INVOICE_STATUSES, ...LEGACY_OPEN_RECEIPT_INVOICE_STATUSES]],
      ["CreditNoteStatus", LEGACY_OPEN_CREDIT_NOTE_STATUSES],
      ["AffiliateCommissionStatus", LEGACY_OPEN_AFFILIATE_COMMISSION_STATUSES],
      ["ExternalWebhookEventStatus", LEGACY_UNSETTLED_WEBHOOK_STATUSES],
    ];
    for (const [name, used] of pairs) {
      const values = enumValues(name);
      for (const s of used) expect(values, `${name}.${s}`).toContain(s);
    }
  });

  it("the invoice rule matches the invoice lifecycle: only PAID and CANCELLED are final for a self-billed invoice", () => {
    const src = code("src/core/domain/services/invoice-lifecycle.ts");
    expect(src).toMatch(/ISSUED: \["PAID"\]/);
    expect(src).toMatch(/PAID: \[\]/);
    expect(src).toMatch(/CANCELLED: \[\]/);
  });
});

describe("M166 — the verdict can never be 'ready' and nothing is invented", () => {
  it("the rules define no READY value and apply no period, deadline or retention number", () => {
    const src = code(DOMAIN);
    expect(src).not.toMatch(/["']READY["']/);
    expect(src).toMatch(/"NOT_READY" \| "DATA_CLEAN_PENDING_SIGN_OFF"/);
    expect(src).not.toMatch(/\b\d+\s*\*\s*(24|60|1000)\b|setDate|DAYS?_|RETENTION_(DAYS|PERIOD)|NOTICE_(DAYS|PERIOD)\s*=/);
  });

  it("the module document exists, states the scope boundaries and does not claim Gate C", () => {
    expect(existsSync(path.join(root, DOC))).toBe(true);
    const doc = read(DOC);
    for (const needle of ["Non-goals", "M167", "M168", "M169", "Gate C", "D20", "DATA_CLEAN_PENDING_SIGN_OFF", "Test evidence", "Idempotency"]) expect(doc, needle).toContain(needle);
    expect(doc).toMatch(/does not (pass|claim)[^.]*Gate C/i);
  });
});
