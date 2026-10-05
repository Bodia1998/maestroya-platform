import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * Module 121 — static contract tests: the additive schema change keeps every
 * historical row legacy, and every production composition root wires the
 * flow guard into the legacy financial use cases (an un-wired optional guard
 * would silently fail open).
 */
const root = process.cwd();
const read = (p: string) => readFileSync(join(root, p), "utf8");

describe("Module 121 schema / migration contract (test 8: historical records stay readable)", () => {
  const schema = read("prisma/schema.prisma");

  it("adds ServiceRequest.flowVersion defaulting to LEGACY_QUOTE_PAYMENT", () => {
    expect(schema).toMatch(/enum TransactionFlowVersion \{\s*LEGACY_QUOTE_PAYMENT\s*LEAD_V1\s*\}/);
    expect(schema).toMatch(/flowVersion\s+TransactionFlowVersion\s+@default\(LEGACY_QUOTE_PAYMENT\)/);
  });

  it("migration is additive: no DROP/DELETE/TRUNCATE/UPDATE, default keeps existing rows legacy", () => {
    const dir = readdirSync(join(root, "prisma/migrations")).find((d) => d.endsWith("add_module_121_transaction_flow_version"));
    expect(dir).toBeDefined();
    const sql = read(`prisma/migrations/${dir}/migration.sql`)
      .split("\n")
      .filter((l) => !l.trim().startsWith("--"))
      .join("\n");
    expect(sql).not.toMatch(/\b(DROP|DELETE|TRUNCATE|UPDATE|RENAME)\b/i);
    expect(sql).toContain("ADD COLUMN \"flowVersion\" \"TransactionFlowVersion\" NOT NULL DEFAULT 'LEGACY_QUOTE_PAYMENT'");
  });
});

describe("Module 121 composition wiring", () => {
  const wired: Array<[string, string]> = [
    ["src/core/application/use-cases/quotes/compose.ts", "CreateQuoteUseCase"],
    ["src/core/application/use-cases/quotes/compose.ts", "AcceptQuoteUseCase"],
    ["src/core/application/use-cases/payments/compose.ts", "InitiateQuotePaymentUseCase"],
    ["src/core/application/use-cases/payments/compose.ts", "ProcessCustomerPaymentWebhookUseCase"],
    ["src/core/application/use-cases/payments/compose.ts", "ExecuteProfessionalPayoutUseCase"],
    ["src/core/application/use-cases/financial/compose.ts", "RecordCommissionForPaymentUseCase"],
    ["src/core/application/use-cases/job/compose.ts", "EvaluatePaymentReleaseUseCase"],
    ["src/core/application/use-cases/job/compose.ts", "AdminResolvePaymentReleaseUseCase"],
    ["src/core/application/use-cases/invoicing/compose.ts", "CreateProfessionalInvoiceDraftUseCase"],
    ["src/core/application/use-cases/invoicing/compose.ts", "CreateCustomerReceiptDraftUseCase"],
    ["src/core/application/use-cases/affiliate/compose.ts", "RecordAffiliateConversionOnPaymentReleaseApprovedSubscriber"],
  ];

  it.each(wired)("%s passes transactionFlowGuard to %s", (file, cls) => {
    const src = read(file);
    const start = src.indexOf(`new ${cls}(`);
    expect(start).toBeGreaterThan(-1);
    const end = src.indexOf(");", start);
    expect(src.slice(start, end)).toContain("transactionFlowGuard");
  });
});
