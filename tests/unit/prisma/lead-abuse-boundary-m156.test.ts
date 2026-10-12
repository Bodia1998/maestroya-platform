import { readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

/**
 * Module 156 — static contract. The fraud & abuse layer: (1) cannot reach any financial path; (2) never modifies a purchase, a
 * dispute or a revocation (M155) and only COUNTS them; (3) is attached to the application in exactly three composition roots
 * and nowhere else; (4) leaves the M138/M139 contact use case and the M153-M155 code untouched; (5) has an additive migration that
 * touches no existing object; (6) is OFF by default.
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

const UC_DIR = "src/core/application/use-cases/lead-abuse/";
const DOMAIN = "src/core/domain/services/lead-abuse-controls.ts";
const PORT = "src/core/domain/repositories/lead-abuse-control-repository.ts";
const REPO = "src/core/infrastructure/database/prisma/repositories/prisma-lead-abuse-control-repository.ts";
const CONFIG = "src/core/infrastructure/config/lead-abuse-control-config.ts";
const COMPOSE = `${UC_DIR}compose.ts`;
const M156_FILES = SRC.filter((f) => f.startsWith(UC_DIR)).concat([DOMAIN, PORT, REPO, CONFIG]);
const MIGRATION = "prisma/migrations/20261022000000_add_module_156_lead_abuse_controls/migration.sql";
const VIEW_MIGRATION = "prisma/migrations/20261023000000_add_module_156_dispute_facts_view/migration.sql";
const sql = () => read(MIGRATION).replace(/^\s*--.*$/gm, "");

/**
 * Module 157 — the Lead Admin Operations Console is the FIRST caller of this module and a READ MODEL over its table. It is allow-listed
 * here by exact path; `lead-admin-console-boundary-m157.test.ts` proves the allow-listed files only read and only call the module's
 * existing use cases (no business rule is re-implemented).
 */
const M157_ADMIN_DIR = "src/app/(dashboard)/admin/leads/";
const M157_READER = "src/core/infrastructure/database/prisma/repositories/prisma-lead-admin-console-reader.ts";
const M157_CORE = [
  M157_READER,
  "src/core/domain/repositories/lead-admin-console-reader.ts",
  "src/core/domain/services/lead-admin-console.ts",
  "src/core/application/dto/lead-admin-console.dto.ts",
];
const isM157 = (f: string) => f.startsWith(M157_ADMIN_DIR) || f.startsWith("src/core/application/use-cases/lead-admin-console/") || M157_CORE.includes(f);

const FORBIDDEN_IMPORT =
  /stripe|refund|ledger|invoice|credit-?note|payout|payment|commission|affiliate|reconcil|lead-fee|lead-quality-claim|lead-purchase-repository|lead-purchase\.use-case|transition-lead-purchase|confirm-lead-purchase/i;

describe("M156 — financial isolation", () => {
  it("the surface is exactly these files (and the audit action names in the two audit files)", () => {
    expect(M156_FILES.length).toBeGreaterThanOrEqual(8);
    const mentions = SRC.filter((f) => /LeadAbuse|lead-abuse|lead_abuse/.test(code(f)));
    const allowedOutside = [
      "src/core/domain/repositories/admin-audit-log-repository.ts",
      "src/core/infrastructure/database/prisma/repositories/prisma-admin-audit-log-repository.ts",
      "src/core/application/use-cases/lead-publication/compose.ts",
      "src/core/application/use-cases/lead-purchase/compose.ts",
      "src/core/application/use-cases/lead-contact/compose.ts",
    ];
    expect(mentions.filter((f) => !M156_FILES.includes(f) && !allowedOutside.includes(f) && !isM157(f))).toEqual([]);
  });

  it("no M156 file imports a payment, refund, ledger, invoice, credit-note, payout, affiliate, reconciliation, dispute-processing or purchase-mutation module", () => {
    for (const f of M156_FILES) {
      const imports = (code(f).match(/from\s+"[^"]+"/g) ?? []).filter((i) => !/lead-abuse|admin-audit-log-repository|prisma-admin-audit-log-repository/.test(i));
      for (const i of imports) expect(i, `${f}: ${i}`).not.toMatch(FORBIDDEN_IMPORT);
    }
  });

  it("the only M155 vocabulary in M156 is READ-ONLY SQL on dispute / revocation tables in the facts reader", () => {
    for (const f of M156_FILES.filter((x) => x !== REPO)) {
      expect(code(f), f).not.toMatch(/lead_fee_disputes|lead_purchase_revocations|leadFeeDispute|leadPurchaseRevocation|lead_purchases|leadPurchase\b/);
    }
    const repo = code(REPO);
    expect(repo).not.toMatch(/prisma\.(leadPurchase|leadFeeDispute|leadPurchaseRevocation|lead|serviceRequest|leadFeeRefund|payment|invoice)\b/);
    expect(repo).not.toMatch(/tx\.(leadPurchase|leadFeeDispute|leadPurchaseRevocation|lead|serviceRequest)\b/);
  });

  it("every raw statement is a SELECT (counts) or the row lock on the M156 decision row; no raw write exists", () => {
    const repo = code(REPO);
    expect(repo).not.toMatch(/\$executeRaw|\$queryRawUnsafe|\$executeRawUnsafe/);
    const statements = repo.match(/\$queryRaw<[^>]*>`[^`]*`/g) ?? [];
    expect(statements.length).toBe(6); // 4 distinct count statements + the shared dispute-fact count + 1 FOR UPDATE lock
    for (const s of statements) {
      expect(s).toMatch(/SELECT/);
      expect(s.replace(/FOR UPDATE/g, "")).not.toMatch(/\b(INSERT|UPDATE|DELETE|TRUNCATE|ALTER|DROP|CREATE)\b/);
    }
    expect(statements.filter((s) => /FOR UPDATE/.test(s))).toHaveLength(1);
    expect(statements.filter((s) => /FOR UPDATE/.test(s))[0]).toContain('"lead_abuse_decisions"');
  });

  it("raw time comparisons never bind a bare Date: every `since` is converted to UTC explicitly (session time zone independence)", () => {
    const repo = code(REPO);
    expect(repo).not.toMatch(/\$\{since\}/);
    const uses = repo.match(/\$\{since[^}]*\}[^\n]*/g) ?? [];
    expect(uses.length).toBe(5);
    for (const u of uses) expect(u).toMatch(/\$\{since\.toISOString\(\)\}::timestamptz AT TIME ZONE 'UTC'/);
  });

  it("the repository only creates / skip-duplicate-inserts / status-conditionally updates; never deletes or upserts", () => {
    const repo = code(REPO);
    expect(repo).not.toMatch(/\.(delete|deleteMany|upsert)\(/);
    expect((repo.match(/leadAbuseDecision\.update\w*\(/g) ?? []).every((u) => u === "leadAbuseDecision.updateMany(")).toBe(true);
    expect(repo).not.toMatch(/leadAbuseSignal\.(update|updateMany)\(/);
    expect(repo).toMatch(/skipDuplicates: true/);
  });

  it("writes of a decision and its audit entry share one transaction", () => {
    const repo = code(REPO);
    expect((repo.match(/recordAdminAuditLogWithin\(/g) ?? []).length).toBe(3); // automated, admin block, lift
    expect((repo.match(/prisma\.\$transaction\(/g) ?? []).length).toBe(2); // createOrFindActive, lift
  });

  it("the guards cannot touch authorization: no use of the contact reader, no policy call, no purchase / eligibility / verification code", () => {
    const guards = code(`${UC_DIR}lead-abuse-guards.ts`);
    expect(guards).not.toMatch(/readContact|canProfessionalAccessLeadContact|LeadContactReader|LeadContactAuthorizationReader|findFacts/);
    expect(guards).not.toMatch(/eligib|verif|ProfessionalRepository|findByUserId/i);
    expect(guards).toMatch(/class LeadAbuseObservedGetLeadContact/);
  });
});

describe("M156 — attachment points", () => {
  it("exactly three composition roots attach the guards; nothing else imports the M156 compose", () => {
    const importers = SRC.filter((f) => /use-cases\/lead-abuse\/compose"/.test(code(f)) && f !== COMPOSE);
    expect(importers.sort()).toEqual([
      "src/core/application/use-cases/lead-contact/compose.ts",
      "src/core/application/use-cases/lead-publication/compose.ts",
      "src/core/application/use-cases/lead-purchase/compose.ts",
      // Module 157: the admin console's Server Actions are the single caller of the M156 ADMIN use cases (never of the guards)
      "src/app/(dashboard)/admin/leads/actions.ts",
    ].sort());
    expect(code("src/core/application/use-cases/lead-publication/compose.ts")).toMatch(/guardLeadPublication\(/);
    expect(code("src/core/application/use-cases/lead-purchase/compose.ts")).toMatch(/guardLeadPurchaseInitiation\(/);
    expect(code("src/core/application/use-cases/lead-contact/compose.ts")).toMatch(/observeLeadContactAccess\(/);
  });

  it("no route, page, Server Action, webhook, job or UI file reaches M156 except the Module 157 admin console (admin use cases have exactly that one caller)", () => {
    const entryPoints = SRC.filter((f) => !isM157(f)).filter((f) => /(^|\/)app\//.test(f) || /\/(actions?|jobs?|cron|webhooks?|queues?|workers?|subscribers?)\//.test(f) || /^(middleware|instrumentation)\.ts$/.test(f) || /route\.ts$/.test(f) || /actions?\.ts$/.test(f));
    expect(entryPoints.length).toBeGreaterThan(10);
    for (const f of entryPoints) expect(code(f), f).not.toMatch(/LeadAbuse|lead-abuse|lead_abuse/);
  });

  it("each use case is constructed only by the M156 composition root (or the three guard factories' wrappers)", () => {
    for (const name of ["ImposeLeadAbuseBlockUseCase", "LiftLeadAbuseDecisionUseCase", "ListOpenLeadAbuseFlagsUseCase", "EvaluateLeadAbuseUseCase"]) {
      expect(SRC.filter((f) => new RegExp(`new ${name}\\b`).test(code(f)))).toEqual([COMPOSE]);
    }
    for (const name of ["LeadAbuseGuardedPublishLead", "LeadAbuseGuardedInitiatePurchase", "LeadAbuseObservedGetLeadContact"]) {
      expect(SRC.filter((f) => new RegExp(`new ${name}\\b`).test(code(f)))).toEqual([COMPOSE]);
    }
  });

  it("the M138/M139 contact use case and the M153-M155 code do not know M156", () => {
    const untouched = [
      "src/core/application/use-cases/lead-contact/get-lead-contact.use-case.ts",
      "src/core/domain/services/lead-contact-access-policy.ts",
      "src/core/infrastructure/database/prisma/repositories/prisma-lead-contact-access-repository.ts",
      "src/core/application/use-cases/lead/publish-lead.use-case.ts",
      "src/core/application/use-cases/lead-purchase/initiate-lead-purchase.use-case.ts",
      ...SRC.filter((f) => /use-cases\/(lead-fee-refund|lead-quality-claim|lead-fee-dispute)\//.test(f)),
      "src/core/domain/services/lead-fee-dispute.ts",
      "src/core/domain/services/lead-quality-claim.ts",
      "src/core/infrastructure/database/prisma/repositories/prisma-lead-fee-dispute-repository.ts",
      "src/core/infrastructure/database/prisma/repositories/prisma-lead-fee-refund-repository.ts",
      "src/core/infrastructure/database/prisma/repositories/prisma-lead-quality-claim-repository.ts",
    ];
    for (const f of untouched) expect(code(f), f).not.toMatch(/LeadAbuse|lead-abuse|lead_abuse/);
  });

  it("the two wrappers that can refuse do so with existing, already-localised errors only", () => {
    const guards = code(`${UC_DIR}lead-abuse-guards.ts`);
    // hardening: the only new refusal is the platform's existing generic retryable RateLimitedError (no new error type)
    expect(guards.match(/throw new \w+/g)).toEqual(["throw new AccountRestrictedError", "throw new RateLimitedError"]);
    expect(guards).toMatch(/if \(first instanceof RateLimitedError\) throw first;/);
    expect(guards).toMatch(/if \(second instanceof RateLimitedError\) throw second;/);
  });
});

describe("M156 — safe defaults", () => {
  it("the mode defaults to OFF in the domain parser, the default config and the environment loader", () => {
    expect(code(DOMAIN)).toMatch(/DEFAULT_LEAD_ABUSE_MODE: LeadAbuseMode = "OFF"/);
    expect(code(CONFIG)).toMatch(/parseLeadAbuseControlConfig\(source\)/);
    expect(code(COMPOSE).match(/if \(config\.mode === "OFF"\) return inner;/g)).toHaveLength(3);
  });

  it("the env switch is read from the process environment, not from request data, and is not part of env.ts", () => {
    expect(code(CONFIG)).toMatch(/source: Readonly<Record<string, string \| undefined>> = process\.env/);
    expect(code("src/core/infrastructure/config/env.ts")).not.toMatch(/LEAD_ABUSE/);
  });
});

describe("M156 — migration is additive", () => {
  it("creates only lead_abuse_* objects and their enums; drops / alters nothing that exists", () => {
    const text = sql();
    expect(text).not.toMatch(/\bDROP\s+(TABLE|COLUMN|INDEX|TYPE|CONSTRAINT|TRIGGER|FUNCTION)\b/i);
    expect(text).not.toMatch(/\bTRUNCATE\b|\bDELETE\s+FROM\b|\bUPDATE\s+"|\bINSERT\s+INTO\b/i);
    const alters = text.match(/ALTER\s+TABLE\s+"[^"]+"/gi) ?? [];
    expect(alters.length).toBe(2);
    for (const a of alters) expect(a).toMatch(/"lead_abuse_(signals|decisions)"/);
    expect((text.match(/CREATE\s+TABLE\s+"[^"]+"/gi) ?? []).sort()).toEqual(['CREATE TABLE "lead_abuse_decisions"', 'CREATE TABLE "lead_abuse_signals"']);
    for (const t of text.match(/CREATE\s+(UNIQUE\s+)?INDEX\s+"[^"]+"\s+ON\s+"[^"]+"/gi) ?? []) expect(t).toMatch(/"lead_abuse_(signals|decisions)"$/);
    for (const t of text.match(/CREATE\s+TRIGGER\s+\w+\s+(BEFORE|AFTER)[\s\S]*?ON\s+"[^"]+"/gi) ?? []) expect(t).toMatch(/"lead_abuse_(signals|decisions)"$/);
    expect(text).not.toMatch(/lead_purchases|lead_fee_|lead_purchase_revocations|payments|refunds|invoices|credit_notes/);
  });

  it("every block must expire (no permanent block) and ACTIVE decisions are unique per kind", () => {
    const text = sql();
    expect(text).toMatch(/lead_abuse_decisions_block_expiry_check/);
    expect(text).toMatch(/"expiresAt" IS NOT NULL AND "expiresAt" > "decidedAt"/);
    expect(text).toMatch(/INTERVAL '24 hours'/);
    expect(text).toMatch(/lead_abuse_decisions_one_active_flag/);
    expect(text).toMatch(/lead_abuse_decisions_one_active_block/);
    expect(text).toMatch(/lead_abuse_signals_dedupeKey_key/);
  });
});

describe("M156 — M155 fact view is a SELECT-only, additive dependency", () => {
  const text = () => read(VIEW_MIGRATION).replace(/^\s*--.*$/gm, "");

  it("creates exactly one view and no table, index, trigger, function or DML; reads only the three M155/M123 sources", () => {
    const t = text();
    expect(t.match(/CREATE\s+VIEW\s+"[^"]+"/gi)).toEqual(['CREATE VIEW "lead_abuse_professional_dispute_facts"']);
    expect(t).not.toMatch(/\b(DROP|ALTER|TRUNCATE|DELETE|UPDATE|INSERT|CREATE\s+(TABLE|INDEX|UNIQUE|TRIGGER|FUNCTION|TYPE))\b/i);
    expect([...new Set(t.match(/\b(?:FROM|JOIN)\s+"[^"]+"/gi) ?? [])].map((x) => x.replace(/^(FROM|JOIN)\s+/i, "")).sort()).toEqual(['"lead_fee_disputes"', '"lead_purchase_revocations"', '"lead_purchases"', '"professional_profiles"']);
  });

  it("only the M156 repository reads the view, and the M155 tables are never named in M156 TypeScript", () => {
    expect(SRC.filter((f) => /lead_abuse_professional_dispute_facts/.test(code(f)))).toEqual([REPO]);
    for (const f of M156_FILES) expect(code(f), f).not.toMatch(/lead_fee_disputes|lead_purchase_revocations|\.leadFeeDispute\b|\.leadPurchaseRevocation\b/);
  });
});
