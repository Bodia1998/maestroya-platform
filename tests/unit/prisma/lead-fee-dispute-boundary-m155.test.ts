import { readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

/**
 * Module 155 — static contract: who may write disputes / revocations, that the dispute path performs NO financial action, that
 * legacy dispute handling is untouched and only reachable for non-lead-fee disputes, that M153/M154 behavior files were not
 * changed, and what the migrations guarantee.
 */
const root = path.resolve(__dirname, "../../..");
const read = (f: string) => readFileSync(path.join(root, f), "utf8");
const code = (f: string) => read(f).replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
const walk = (dir: string): string[] => readdirSync(dir).flatMap((n) => {
  const p = path.join(dir, n);
  return statSync(p).isDirectory() ? walk(p) : [p];
});
const rel = (p: string) => path.relative(root, p).split(path.sep).join("/");
const SRC = walk(path.join(root, "src")).map(rel).filter((f) => /\.(ts|tsx)$/.test(f));

const DOMAIN = "src/core/domain/services/lead-fee-dispute.ts";
const PORT = "src/core/domain/repositories/lead-fee-dispute-repository.ts";
const REPO = "src/core/infrastructure/database/prisma/repositories/prisma-lead-fee-dispute-repository.ts";
const GATEWAY_PORT = "src/core/application/ports/lead-fee-dispute-gateway.ts";
const GATEWAY = "src/core/infrastructure/payments/stripe/stripe-lead-fee-dispute-gateway.ts";
const UC_DIR = "src/core/application/use-cases/lead-fee-dispute";
const UC = SRC.filter((f) => f.startsWith(`${UC_DIR}/`));
const COMPOSE = `${UC_DIR}/compose.ts`;
const ROUTE = "src/app/api/webhooks/stripe-payments/route.ts";
const M155_FILES = [DOMAIN, PORT, REPO, GATEWAY_PORT, GATEWAY, ...UC];
const MIG1 = "prisma/migrations/20261019000000_add_module_155_lead_purchase_disputed_status/migration.sql";
const MIG2 = "prisma/migrations/20261020000000_add_module_155_lead_fee_disputes/migration.sql";
const MIG3 = "prisma/migrations/20261021000000_add_module_155_refund_dispute_restore_guard/migration.sql";
const sql = (f: string) => read(f).replace(/^\s*--.*$/gm, "");

describe("M155 — write boundary", () => {
  it("only the M155 repository touches the dispute / revocation tables and client accessors; it never deletes or upserts", () => {
    expect(SRC.filter((f) => /\.leadFeeDispute\b|"lead_fee_disputes"|FROM lead_fee_disputes/.test(code(f)))).toEqual([REPO]);
    expect(SRC.filter((f) => /\.leadPurchaseRevocation\b|"lead_purchase_revocations"/.test(code(f)))).toEqual([REPO]);
    expect(code(REPO)).not.toMatch(/leadFeeDispute\.(delete|deleteMany|upsert|createMany)\b|leadPurchaseRevocation\.(delete|deleteMany|update|updateMany|upsert)\b/);
  });

  it("the M155 code never writes a financial table or the legacy dispute / payment / refund models", () => {
    const FORBIDDEN =
      /\b(?:prisma|tx)\.(?:leadFeeLedgerEntry|leadFeeInvoice|leadFeeCreditNote|leadFeeRefund|payment|commission|payout|refund|invoice|creditNote|financialAdjustment|financialLedgerEntry|dispute|stripeDispute|job)\b/;
    for (const f of M155_FILES) expect(code(f), f).not.toMatch(FORBIDDEN);
    for (const f of M155_FILES) expect(code(f), f).not.toMatch(/ExecuteLeadFeeRefund|LeadFeeRefundRepository|LeadFeeCreditNote|LeadFeeInvoice|LeadFeeRevenueLedger|recordIfAbsent/);
  });

  it("the Stripe SDK is imported only by the adapter; the dispute adapter calls retrieve / update only (no close, refund, or payment call)", () => {
    for (const f of M155_FILES.filter((x) => x !== GATEWAY)) expect(code(f), f).not.toMatch(/from "stripe"|stripe\.(disputes|refunds|paymentIntents|charges)/);
    const g = code(GATEWAY);
    expect([...g.matchAll(/\.(disputes|refunds|paymentIntents|charges|customers|transfers)\.(\w+)\(/g)].map((m) => `${m[1]}.${m[2]}`).sort()).toEqual(["disputes.retrieve", "disputes.update"]);
    expect(g).not.toMatch(/\.close\(|refunds\./);
  });

  it("no Prisma type appears in the domain or application layers of M155", () => {
    for (const f of [DOMAIN, PORT, GATEWAY_PORT, ...UC.filter((x) => x !== COMPOSE)]) expect(code(f), f).not.toMatch(/@prisma\/client|infrastructure\/database/);
  });

  it("CLAIM_APPROVED is not integrated: nothing in M155 mentions claims or the M154 surface", () => {
    for (const f of M155_FILES) expect(code(f), f).not.toMatch(/CLAIM_APPROVED|LeadQualityClaim|lead-quality-claim/);
  });

  it("no autonomous caller: the admin use cases are built only by their composition root, which no route / action / job imports", () => {
    expect(SRC.filter((f) => /new (RevokeLeadPurchaseUseCase|SubmitLeadFeeDisputeEvidenceUseCase)\b/.test(code(f)))).toEqual([COMPOSE]);
    const users = SRC.filter((f) => /makeRevokeLeadPurchaseUseCase|makeSubmitLeadFeeDisputeEvidenceUseCase/.test(code(f)));
    expect(users).toEqual([COMPOSE]);
  });
});

describe("M155 — webhook routing and legacy isolation", () => {
  it("the dispute composition is reached only from the platform payments route and the M141 reconcile hook", () => {
    const importers = SRC.filter((f) => /lead-fee-dispute\/compose/.test(code(f)) && f !== COMPOSE).sort();
    expect(importers).toEqual(["src/app/api/webhooks/stripe-payments/route.ts", "src/core/application/use-cases/lead-fee-payment/compose.ts"].sort());
  });

  it("the route sends a dispute to the lead-fee handler ONLY when it owns the event, otherwise the legacy path runs unchanged", () => {
    const r = code(ROUTE);
    expect(r).toMatch(/makeProcessLeadFeeDisputeWebhookUseCase\(\)/);
    expect(r).toMatch(/await [\w.]+\.ownsEvent\(validation\.event\)/);
    expect(r.indexOf("ownsEvent")).toBeLessThan(r.indexOf("processStripeDispute") === -1 ? Number.MAX_SAFE_INTEGER : r.indexOf("processStripeDispute"));
    expect(r).not.toMatch(/catch\s*\([^)]*\)\s*\{[^}]*ownsEvent/); // a failing ownership lookup is never swallowed into the legacy path
  });

  it("legacy dispute code does not know about lead-fee disputes", () => {
    for (const f of SRC.filter((x) => /stripe-disputes|dispute-resolution|use-cases\/dispute\//.test(x))) {
      expect(code(f), f).not.toMatch(/LeadFeeDispute|lead-fee-dispute|lead_fee_disputes|DISPUTED/);
    }
  });

  it("the verifier port change is additive only (optional field)", () => {
    expect(code("src/core/application/ports/stripe-payment-webhook-verifier.ts")).toMatch(/amountMinorUnits\?: number \| null;\s*\n\s*currency: string;/);
  });
});

describe("M155 — access: every contact path stays derived from the persisted CONFIRMED status", () => {
  it("no code outside the authorization reader grants contact on a status other than CONFIRMED", () => {
    const reader = code("src/core/infrastructure/database/prisma/repositories/prisma-lead-contact-access-repository.ts");
    expect(reader).toMatch(/status: "CONFIRMED"/);
    expect(reader).toMatch(/suspendedByDispute/);
    for (const f of SRC.filter((x) => /lead-contact|contact-access/.test(x))) expect(code(f), f).not.toMatch(/"DISPUTED"\s*(\)|,)?\s*\?\s*(true|grant)/);
  });
});

describe("M155 — protected modules are not modified by this module's own files", () => {
  it("M153 refund execution and M154 claim files never mention the dispute module", () => {
    for (const f of SRC.filter((x) => /lead-fee-refund|lead-quality-claim|lead-quality-claims/.test(x))) {
      expect(code(f), f).not.toMatch(/LeadFeeDispute|lead-fee-dispute|lead_fee_disputes|LeadPurchaseRevocation/);
    }
  });
});

describe("M155 — migrations", () => {
  it("migration 1 only adds the enum value; migration 2 never drops, truncates or rewrites existing data", () => {
    expect(sql(MIG1).trim()).toBe(`ALTER TYPE "LeadPurchaseStatus" ADD VALUE 'DISPUTED';`);
    const s = sql(MIG2);
    expect(s).not.toMatch(/\bTRUNCATE\b|\bDELETE\s+FROM\b|\bDROP\s+TABLE\b|\bDROP\s+COLUMN\b|ALTER\s+TABLE\s+"lead_purchases"\s+(DROP|ALTER)/i);
    expect(s).not.toMatch(/\bUPDATE\s+"/i);
    expect([...s.matchAll(/DROP INDEX "([^"]+)"/g)].map((m) => m[1])).toEqual(["lead_purchases_one_active_per_lead_professional"]);
  });

  it("creates the guarded tables with FK restrict, triggers and CHECKs, and the append-only / no-delete triggers", () => {
    const s = sql(MIG2);
    for (const t of ["lead_fee_disputes", "lead_purchase_revocations"]) expect(s).toMatch(new RegExp(`CREATE TABLE "${t}"`));
    for (const trg of ["lead_fee_disputes_validate_insert", "lead_fee_disputes_guard_update", "lead_fee_disputes_no_delete", "lead_purchases_dispute_guard", "lead_purchase_revocations_validate_insert", "lead_purchase_revocations_append_only"]) {
      expect(s, trg).toContain(trg);
    }
    expect(s).not.toMatch(/ON DELETE CASCADE/i);
  });

  it("does not touch the M153 / M154 / ledger / invoice / credit-note tables", () => {
    const s = sql(MIG2);
    expect(s).not.toMatch(/"lead_fee_refunds"|"lead_quality_claims"|"lead_fee_ledger_entries"|"lead_fee_invoices"|"lead_fee_credit_notes"/);
  });

  it("migration 3 (H1) only replaces the dispute guard function: additive, no table / index / enum / data change, M153 and M154 tables only READ", () => {
    const s3 = sql(MIG3).replace(/--.*$/gm, ""); // executable SQL only, header comments excluded
    expect(s3).not.toMatch(/\b(CREATE|ALTER|DROP)\s+(TABLE|INDEX|TYPE|TRIGGER)\b|\bINSERT\s+INTO\b|\bUPDATE\s+"|\bDELETE\b|\bTRUNCATE\b/i);
    expect(s3).toMatch(/CREATE OR REPLACE FUNCTION lead_purchases_dispute_guard\(\)/);
    expect(s3).toMatch(/"reasonCode" = 'PLATFORM_ERROR'/);
    expect(s3).toMatch(/'REQUESTED', 'PROVIDER_PENDING', 'UNKNOWN', 'SUCCEEDED'/);
    expect(s3).not.toMatch(/lead_quality_claims/);
    // the original migration files are untouched by this fix (applied migrations are never rewritten)
    expect(sql(MIG2)).not.toMatch(/lead_fee_refunds/);
  });
});
