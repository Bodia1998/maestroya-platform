import { readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

/**
 * Module 154 (Part A) — static contract: the claim workflow is isolated from refunds, payments, the ledger, invoices and credit
 * notes; nothing calls it (no route, Server Action, webhook, job, subscriber, notification); only its Prisma adapter touches its
 * table; and the migration is additive and touches no other table.
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

const DOMAIN = "src/core/domain/services/lead-quality-claim.ts";
const PORT = "src/core/domain/repositories/lead-quality-claim-repository.ts";
const REPO = "src/core/infrastructure/database/prisma/repositories/prisma-lead-quality-claim-repository.ts";
const DTO = "src/core/application/dto/lead-quality-claim.dto.ts";
const UC_DIR = "src/core/application/use-cases/lead-quality-claim/";
const COMPOSE = `${UC_DIR}compose.ts`;
const M154_FILES = SRC.filter((f) => f.startsWith(UC_DIR)).concat([DOMAIN, PORT, REPO, DTO]);
const MIGRATION = "prisma/migrations/20261017000000_add_module_154_lead_quality_claims/migration.sql";
const sql = () => read(MIGRATION).replace(/^\s*--.*$/gm, "");

const mentionsClaim = (f: string) => /LeadQualityClaim|lead-quality-claim|lead_quality_claims/.test(code(f));

describe("M154 — surface and callers", () => {
  it("the whole claim surface is exactly these files, plus the audit action names in the two existing audit files", () => {
    const AUDIT_FILES = ["src/core/domain/repositories/admin-audit-log-repository.ts", "src/core/infrastructure/database/prisma/repositories/prisma-admin-audit-log-repository.ts"];
    expect(SRC.filter(mentionsClaim).filter((f) => !AUDIT_FILES.includes(f)).sort()).toEqual([...M154_FILES].sort());
    for (const f of AUDIT_FILES) expect(code(f).match(/LEAD_QUALITY_CLAIM_[A-Z_]+/g)?.length ?? 0).toBeGreaterThan(0);
    expect(M154_FILES.length).toBeGreaterThanOrEqual(9);
  });

  it("only the Prisma adapter touches the claims table / client accessor, and it never deletes, upserts or updates content", () => {
    expect(SRC.filter((f) => /leadQualityClaim\b|lead_quality_claims/.test(code(f)))).toEqual([REPO]);
    expect(code(REPO)).not.toMatch(/leadQualityClaim\.(delete|deleteMany|upsert|createMany)\b/);
    expect(code(REPO)).not.toMatch(/\$executeRaw/);
    // the only raw statements: the row lock that reads the current status, and the database clock read for the audit entry
    const raw = code(REPO).match(/\$queryRaw<[^>]*>`[^`]*`/g) ?? [];
    expect(raw).toHaveLength(2);
    expect(raw.some((r) => /FROM "lead_quality_claims" WHERE "id" = \$\{id\}::uuid FOR UPDATE/.test(r))).toBe(true);
    expect(raw.some((r) => /clock_timestamp\(\)/.test(r))).toBe(true);
    const updates = code(REPO).match(/leadQualityClaim\.update\w*\(/g) ?? [];
    expect(updates.every((u) => u === "leadQualityClaim.updateMany(")).toBe(true);
  });

  it("nothing outside the claim modules imports the use cases or the composition root: no route, page, action, webhook, job, queue, subscriber or UI", () => {
    expect(SRC.filter((f) => /use-cases\/lead-quality-claim\/|makeSubmitLeadQualityClaim|makeDecideLeadQualityClaim|makeStartLeadQualityClaimReview/.test(code(f)) && !f.startsWith(UC_DIR))).toEqual([]);
    const entryPoints = SRC.filter((f) => /(^|\/)app\//.test(f) || /\/(actions?|jobs?|cron|webhooks?|queues?|workers?|subscribers?)\//.test(f) || /^(middleware|instrumentation)\.ts$/.test(f) || /route\.ts$/.test(f) || /actions?\.ts$/.test(f));
    expect(entryPoints.length).toBeGreaterThan(10);
    for (const f of entryPoints) expect(code(f), f).not.toMatch(/LeadQualityClaim|lead-quality-claim|lead_quality_claims/);
  });

  it("each use case is constructed only by its composition root", () => {
    for (const name of ["SubmitLeadQualityClaimUseCase", "StartLeadQualityClaimReviewUseCase", "DecideLeadQualityClaimUseCase"]) {
      expect(SRC.filter((f) => new RegExp(`new ${name}\\b`).test(code(f)))).toEqual([COMPOSE]);
    }
  });

  it("no notification event or subscriber exists for claims", () => {
    expect(SRC.filter((f) => /subscribe\(\s*\w*Claim|LeadQualityClaim(Submitted|Approved|Rejected|Decided)\b|events\/lead-quality-claim/.test(code(f)))).toEqual([]);
    expect(SRC.filter((f) => /\.(publish|publishAll)\(/.test(code(f)) && f.startsWith(UC_DIR))).toEqual([]);
  });
});

describe("M154 — atomic audit (H1) and separation of duties (M2) wiring", () => {
  it("each transition is written in a $transaction together with its audit entry, through the existing audit adapter", () => {
    const repo = code(REPO);
    expect((repo.match(/prisma\.\$transaction\(/g) ?? []).length).toBe(3); // create, markReviewStarted, decide
    expect(repo).toMatch(/recordAdminAuditLogWithin\(/);
    expect((repo.match(/writeAudit\(tx,/g) ?? []).length).toBe(3);
    expect(code("src/core/infrastructure/database/prisma/repositories/prisma-admin-audit-log-repository.ts")).not.toMatch(/auditLog\.(update|updateMany|delete|deleteMany|upsert)\b/);
  });

  it("the use cases no longer audit on their own (no best-effort, post-commit audit path remains)", () => {
    for (const f of M154_FILES.filter((x) => x.startsWith(UC_DIR) && !x.endsWith("compose.ts"))) {
      expect(code(f), f).not.toMatch(/AdminAuditLogRepository|recordClaimAudit|failureReporter|FailureReporter|audit\.record/);
    }
  });

  it("start-review and decide check ownership before any state decision", () => {
    for (const f of ["start-lead-quality-claim-review", "decide-lead-quality-claim"]) {
      const c = code(`${UC_DIR}${f}.use-case.ts`);
      expect(c).toMatch(/assertNotOwnClaim\(/);
      expect(c.indexOf("assertNotOwnClaim(")).toBeLessThan(c.indexOf("canTransitionLeadQualityClaim("));
    }
  });

  it("the submit use case no longer decides the window and no longer sends timestamps to the repository", () => {
    const c = code(`${UC_DIR}submit-lead-quality-claim.use-case.ts`);
    expect(c).not.toMatch(/isWithinLeadQualityClaimWindow|leadQualityClaimRespondBy|submittedAt|respondBy/);
    expect(code(PORT)).not.toMatch(/LeadQualityClaimDraft \{[^}]*(submittedAt|respondBy)/);
  });
});

describe("M154 — isolation from refunds and money", () => {
  const IMPORT_FORBIDDEN =
    /lead-fee-refund|LeadFeeRefund|lead-fee-payment|LeadFeePayment|stripe|Stripe|payment-gateway|refund-executor|lead-fee-revenue-ledger|lead-fee-invoice|lead-fee-credit-note|lead-purchase-refunded|LeadPurchaseRefunded|TransitionLeadPurchaseUseCase/;

  it("no claim source file references M153 refunds, payment gateways/Stripe, the ledger, invoices, credit notes, refund events or the purchase transition use case", () => {
    for (const f of M154_FILES) expect(code(f), f).not.toMatch(IMPORT_FORBIDDEN);
  });

  it("the claim domain and port never write a purchase and carry no money type", () => {
    for (const f of [DOMAIN, PORT, DTO]) expect(code(f), f).not.toMatch(/\bamount\b|totalAmount|currency|paymentReference|Decimal|refund/i);
    for (const f of M154_FILES.filter((x) => x.startsWith(UC_DIR))) expect(code(f), f).not.toMatch(/\.transition\(|leadPurchase\.(update|create|delete)|purchases\.(transition|initiate|create|recordPaymentReference)/);
  });

  it("the M153 refund reasons are unchanged and CLAIM_APPROVED is still absent from the refund schema and migration", () => {
    expect(code("src/core/domain/services/lead-fee-refund.ts")).toContain('["PLATFORM_ERROR", "DUPLICATE_CHARGE"]');
    expect(read("prisma/migrations/20261016000000_add_module_153_lead_fee_refunds/migration.sql")).not.toMatch(/(?<![A-Z_])CLAIM_APPROVED/);
    const schema = read("prisma/schema.prisma");
    const refundEnum = schema.match(/enum LeadFeeRefundReason \{([^}]*)\}/)?.[1] ?? "";
    expect(refundEnum).not.toMatch(/CLAIM/);
    expect(refundEnum).toMatch(/PLATFORM_ERROR/);
  });

  it("no claim file contains a CLAIM_APPROVED refund reason", () => {
    for (const f of M154_FILES) expect(code(f), f).not.toMatch(/(?<![A-Z_])CLAIM_APPROVED/);
  });
});

describe("M154 — hardening migration (M1 database clock, M2 separation-of-duties backstop)", () => {
  const HARDEN = "prisma/migrations/20261018000000_add_module_154_lead_quality_claims_hardening/migration.sql";
  const h = () => read(HARDEN).replace(/^\s*--.*$/gm, "");

  it("is additive: only CREATE OR REPLACE FUNCTION (no table, column, type, index, trigger or constraint change, no data change)", () => {
    const s = h();
    expect(s).not.toMatch(/\b(DROP|ALTER)\s+(TABLE|COLUMN|TYPE|INDEX|TRIGGER|FUNCTION|CONSTRAINT)\b/i);
    expect(s).not.toMatch(/\bCREATE\s+(TABLE|TYPE|INDEX|UNIQUE|TRIGGER)\b/i);
    expect(s).not.toMatch(/^\s*(UPDATE|DELETE\s+FROM|INSERT\s+INTO|TRUNCATE)\b/im);
    expect([...s.matchAll(/CREATE OR REPLACE FUNCTION (\w+)/g)].map((m) => m[1])).toEqual([
      "lead_quality_claims_window_open",
      "lead_quality_claims_validate_insert",
      "lead_quality_claims_guard_update",
    ]);
    expect(s).not.toMatch(/lead_fee_|LeadFee/);
  });

  it("stamps submittedAt from the database clock, derives respondBy, and has no client-clock tolerance left", () => {
    const s = h();
    expect(s).toMatch(/NEW\."submittedAt" := date_trunc\('milliseconds', clock_timestamp\(\) AT TIME ZONE 'UTC'\)/);
    expect(s).toMatch(/NEW\."respondBy" := NEW\."submittedAt" \+ INTERVAL '72 hours'/);
    expect(s).not.toMatch(/not close to the database clock|> 300/);
    expect(s).toMatch(/submitted_at >= confirmed_at AND submitted_at <= confirmed_at \+ INTERVAL '72 hours'/); // inclusive at both ends
  });

  it("the guard refuses a review-start or decision by the owner of the claim's professional profile", () => {
    expect(h()).toMatch(/separation of duties/);
  });
});

describe("M154 — schema and migration", () => {
  const schema = () => read("prisma/schema.prisma");
  const model = () => schema().match(/model LeadQualityClaim \{[\s\S]*?\n\}/)?.[0] ?? "";

  it("the Prisma model is scalar-only (no relation to any existing model), so no existing model is modified", () => {
    expect(model()).not.toMatch(/@relation/);
    expect(model()).not.toMatch(/\bLeadPurchase\b|\bProfessionalProfile\b|\bUser\b/);
    expect(schema().replace(model(), "")).not.toMatch(/^\s+\w+\s+LeadQualityClaim(\[\])?\??\s*(@.*)?$/m);
  });

  it("the model has no refund / ledger / invoice / credit-note / money column", () => {
    expect(model()).not.toMatch(/refund|amount|ledger|invoice|credit|payment|Decimal/i);
  });

  it("the migration is additive: only enums, the claims table, its indexes, constraints, functions and triggers", () => {
    const s = sql();
    expect(s).not.toMatch(/\bDROP\s+(TABLE|COLUMN|TYPE|INDEX|TRIGGER|FUNCTION|CONSTRAINT)\b/i);
    expect(s).not.toMatch(/\bALTER\s+TYPE\b/i);
    expect(s).not.toMatch(/^\s*(UPDATE|DELETE\s+FROM|INSERT\s+INTO|TRUNCATE)\b/im);
    const altered = [...s.matchAll(/ALTER TABLE\s+"([a-z_]+)"/g)].map((m) => m[1]);
    expect(new Set(altered)).toEqual(new Set(["lead_quality_claims"]));
    expect([...s.matchAll(/CREATE TABLE\s+"([a-z_]+)"/g)].map((m) => m[1])).toEqual(["lead_quality_claims"]);
    expect([...s.matchAll(/CREATE TYPE\s+"(\w+)"/g)].map((m) => m[1])).toEqual(["LeadQualityClaimReason", "LeadQualityClaimStatus"]);
    expect(s).not.toMatch(/lead_fee_refunds|lead_fee_ledger|lead_fee_invoices|lead_fee_credit_notes|LeadFeeRefund/);
  });

  it("the migration encodes the approved parameters and guarantees", () => {
    const s = sql();
    expect(s).toMatch(/UNIQUE INDEX "lead_quality_claims_leadPurchaseId_key"/);
    expect(s).toMatch(/"respondBy" = "submittedAt" \+ INTERVAL '72 hours'/);
    expect(s).toMatch(/"confirmedAt" \+ INTERVAL '72 hours'/);
    expect(s).toMatch(/open_claims >= 3/);
    expect(s).toMatch(/recent_claims >= 10/);
    expect(s).toMatch(/INTERVAL '30 days'/);
    expect(s).toMatch(/FOR UPDATE/); // serializes one professional's inserts
    expect(s).toMatch(/BEFORE DELETE ON "lead_quality_claims"/);
    expect(s).toMatch(/'CONTACT_UNREACHABLE', 'CONTACT_INVALID', 'DUPLICATE_LEAD'/);
  });
});
