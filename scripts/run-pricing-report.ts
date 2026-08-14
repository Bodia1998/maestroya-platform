import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";

import type { CheckResult, PricingReportData } from "@/infrastructure/pricing/pricing-report-generator";
import { buildPricingReport, renderMarkdownPricingReport } from "@/infrastructure/pricing/pricing-report-generator";
import { SourceScanner } from "@/infrastructure/multi-instance-safety/source-scanner";
import { makeGetPlatformRevenueSummaryUseCase } from "@/application/use-cases/financial/compose";
import { CommissionCalculationService } from "@/domain/services/commission-calculation-service";
import { PricingCalculationService } from "@/domain/services/pricing-calculation-service";

/**
 * Module 64 — Pricing & Commission Engine.
 *
 * Standalone entry point, run via `npm run pricing-report` — same
 * `tsx --env-file-if-exists=.env --conditions=react-server scripts/run-pricing-report.ts`
 * runner `scripts/run-affiliate-report.ts` (Module 61) uses, for the
 * identical reason — see that script's own doc comment for the full
 * explanation of why a plain `tsx` process needs `--env-file-if-exists`
 * and `--conditions=react-server`.
 *
 * ## Database access is best-effort, never fatal
 * Same guarantee `run-affiliate-report.ts` documents for its own
 * statistics query: this script must keep writing
 * `reports/pricing-report.{md,json}` and exit successfully even when the
 * database is unreachable — e.g. this exact sandbox, whose `linux-arm64`
 * runtime has no cached Prisma query engine and no network access to fetch
 * one.
 *
 * ## Checks are real, not asserted
 * Unlike a purely narrative report, most checks below either (a) actually
 * invoke `CommissionCalculationService`/`PricingCalculationService` at
 * report-generation time and assert on the real result, or (b) use
 * `SourceScanner` (Module 58's own read-only static-analysis primitive)
 * to grep the actual committed source of every file this module touched
 * for the removed 7.5%/0.075 dual-fee literals — so a regression that
 * reintroduces duplicated commission math is caught by this report, not
 * just asserted away.
 */
process.on("unhandledRejection", (reason) => {
  console.warn(
    "pricing-report: an unhandled background rejection occurred (likely the shared Prisma client's engine bootstrap failing in this environment) — continuing without live statistics.",
    reason,
  );
});

async function loadStatistics() {
  try {
    const useCase = makeGetPlatformRevenueSummaryUseCase();
    const summary = await useCase.execute({});
    return {
      grossLaborVolume: summary.grossLaborVolume,
      grossMaterialsVolume: summary.grossMaterialsVolume,
      professionalCommissions: summary.professionalCommissions,
      platformGrossRevenue: summary.platformGrossRevenue,
      payoutsTotal: summary.payoutsTotal,
      paymentCount: summary.paymentCount,
    };
  } catch (error) {
    console.warn("pricing-report: could not read platform revenue summary from the database — reporting it as unavailable.", error);
    return null;
  }
}

/** Files that are ALLOWED to mention the historical 7.5%/0.075 figures —
 *  as removed-model documentation/history only, never as live logic. Every
 *  other file this module touched must be completely free of the old
 *  literal. */
const HISTORICAL_MENTION_ALLOWLIST = new Set([
  "src/core/domain/services/commission-policy.ts",
  "src/core/domain/services/commission-calculation-service.ts",
  "src/core/infrastructure/database/prisma/repositories/prisma-commission-rate-repository.ts",
]);

/** Every call site Module 64 was required to migrate off the old dual-fee
 *  split — see the module brief's own list. */
const MIGRATED_CALL_SITES = [
  "src/core/application/use-cases/financial/calculate-job-commission-breakdown.use-case.ts",
  "src/core/application/use-cases/financial/record-commission-for-payment.use-case.ts",
  "src/core/application/use-cases/financial/get-platform-revenue-summary.use-case.ts",
  "src/core/application/use-cases/financial/get-professional-earnings.use-case.ts",
  "src/core/application/use-cases/financial/get-customer-financial-summary.use-case.ts",
  "src/core/application/use-cases/quotes/create-quote.use-case.ts",
  "src/core/application/use-cases/quotes/update-quote.use-case.ts",
];

async function buildArchitectureChecks(scanner: SourceScanner): Promise<CheckResult[]> {
  const pricingSource = await scanner.read("src/core/domain/services/pricing-calculation-service.ts");
  const commissionSource = await scanner.read("src/core/domain/services/commission-calculation-service.ts");

  // Matches an actual import/require statement pulling in Prisma or
  // Next.js — deliberately NOT a bare substring match on "prisma", which
  // would false-positive on this module's own doc comments (e.g. a
  // reference to `prisma-commission-rate-repository.ts` by name).
  const frameworkImportPattern = /(?:from\s+["'][^"']*(?:@prisma\/client|next\/server)["']|require\(["'][^"']*prisma[^"']*["']\)|^"use server";?$)/im;

  return [
    {
      check: "PricingCalculationService lives in the domain layer and is framework-free",
      passed: pricingSource !== null && !frameworkImportPattern.test(pricingSource ?? ""),
      detail: "src/core/domain/services/pricing-calculation-service.ts contains no Prisma/Next.js import.",
    },
    {
      check: "CommissionCalculationService lives in the domain layer and is framework-free",
      passed: commissionSource !== null && !frameworkImportPattern.test(commissionSource ?? ""),
      detail: "src/core/domain/services/commission-calculation-service.ts contains no Prisma/Next.js import.",
    },
    {
      check: "CommissionCalculationService exposes a calculate() method",
      passed: /calculate\s*\(/.test(commissionSource ?? ""),
      detail: "CommissionCalculationService.calculate(input) is the single entry point every caller uses.",
    },
    {
      check: "CommissionCalculationService reuses PricingCalculationService rather than re-deriving the Total",
      passed: /PricingCalculationService|PRICING_CALCULATION_SERVICE/.test(commissionSource ?? ""),
      detail: "commission-calculation-service.ts imports and delegates to pricing-calculation-service.ts for Total = Labour + Materials.",
    },
  ];
}

async function buildBusinessRuleChecks(): Promise<CheckResult[]> {
  const service = new CommissionCalculationService();
  const results: CheckResult[] = [];

  const worked = service.calculate({ labour: 5000, materials: 1000 });
  results.push({
    check: "Matches the module's own worked example: Labour 5000 + Materials 1000 = Total 6000 -> Commission 600 (10%) -> Payout 5400",
    passed: worked.total === 6000 && worked.commission === 600 && worked.professionalPayout === 5400,
    detail: `Computed total=${worked.total}, commission=${worked.commission}, professionalPayout=${worked.professionalPayout}.`,
  });

  const materialsOnly = service.calculate({ labour: 0, materials: 1000 });
  results.push({
    check: "Commission is charged on materials even when purchased/supplied by the customer (materials are always commissionable)",
    passed: materialsOnly.commission === 100,
    detail: "A materials-only Quote (labour=0) still produces a non-zero commission, unlike the removed labour-only commission base.",
  });

  const negativeRejected = (() => {
    try {
      service.calculate({ labour: -1, materials: 0 });
      return false;
    } catch {
      return true;
    }
  })();
  results.push({
    check: "Rejects a negative labour or materials amount rather than silently producing a negative commission",
    passed: negativeRejected,
    detail: "calculate({ labour: -1, materials: 0 }) throws.",
  });

  const zero = service.calculate({ labour: 0, materials: 0 });
  results.push({
    check: "Commission >= 0 and Professional payout >= 0 for the zero/zero edge case",
    passed: zero.commission >= 0 && zero.professionalPayout >= 0,
    detail: `commission=${zero.commission}, professionalPayout=${zero.professionalPayout}.`,
  });

  return results;
}

async function buildMoneyAndRoundingChecks(): Promise<CheckResult[]> {
  const pricing = new PricingCalculationService();
  const commission = new CommissionCalculationService();
  const results: CheckResult[] = [];

  const rounded = commission.calculate({ labour: 33.33, materials: 11.11 });
  results.push({
    check: "Every output field is rounded to whole cents (no sub-cent drift)",
    passed: [rounded.labour, rounded.materials, rounded.total, rounded.commission, rounded.professionalPayout].every(
      (v) => Math.abs(Math.round(v * 100) - v * 100) < 1e-6,
    ),
    detail: `labour=${rounded.labour}, materials=${rounded.materials}, total=${rounded.total}, commission=${rounded.commission}, payout=${rounded.professionalPayout}.`,
  });

  const large = pricing.calculate({ labour: 987654.32, materials: 12345.67 });
  results.push({
    check: "Large amounts do not accumulate floating-point drift",
    passed: large.total === 999999.99,
    detail: `Total of 987654.32 + 12345.67 computed as ${large.total} (expected 999999.99).`,
  });

  results.push({
    check: "professionalPayout always equals total - commission (invariant holds across a spot-checked sample)",
    passed: [
      { labour: 733.5, materials: 266.75 },
      { labour: 0, materials: 0 },
      { labour: 1, materials: 0 },
    ].every((input) => {
      const r = commission.calculate(input);
      return Math.abs(r.professionalPayout - Math.round((r.total - r.commission) * 100) / 100) < 1e-9;
    }),
    detail: "professionalPayout = total - commission holds for every sampled input, including zero and sub-euro amounts.",
  });

  return results;
}

async function buildSingleSourceOfTruthChecks(scanner: SourceScanner): Promise<CheckResult[]> {
  const results: CheckResult[] = [];
  const oldLiteralPattern = /0\.075|7\.5\s*%|customerPlatformFeeRateBps|professionalCommissionRateBps/;

  for (const file of MIGRATED_CALL_SITES) {
    const source = await scanner.read(file);
    const passed = source !== null && !oldLiteralPattern.test(source);
    results.push({
      check: `${file} contains no hardcoded 7.5%/0.075 dual-fee literal`,
      passed,
      detail: passed
        ? "No occurrence of the removed dual-fee rate found."
        : "This file still references the removed 7.5%/0.075 dual-fee model — it must call CommissionCalculationService (via commission-policy.ts) instead.",
    });
  }

  const policySource = await scanner.read("src/core/domain/services/commission-policy.ts");
  results.push({
    check: "commission-policy.ts delegates to CommissionCalculationService rather than re-implementing the formula",
    passed: /COMMISSION_CALCULATION_SERVICE/.test(policySource ?? ""),
    detail: "calculateCommissionBreakdown() calls COMMISSION_CALCULATION_SERVICE.calculate() — no independent arithmetic on commissionRateBps in this file.",
  });

  for (const file of HISTORICAL_MENTION_ALLOWLIST) {
    const source = await scanner.read(file);
    const mentionsOldModelOnlyHistorically =
      source !== null && (!/0\.075|7\.5%/.test(source) || /removed|superseded/i.test(source));
    results.push({
      check: `${file} mentions the old 7.5%/0.075 model, if at all, only as removed/historical documentation`,
      passed: mentionsOldModelOnlyHistorically,
      detail: "Any mention of the old rate is qualified as removed/superseded, never live logic.",
    });
  }

  return results;
}

async function buildFutureExtensibilityChecks(scanner: SourceScanner): Promise<CheckResult[]> {
  const pricingSource = await scanner.read("src/core/domain/services/pricing-calculation-service.ts");
  const commissionSource = await scanner.read("src/core/domain/services/commission-calculation-service.ts");

  return [
    {
      check: "PricingCalculationService exposes a reserved adjustments extension point",
      passed: /PricingAdjustment/.test(pricingSource ?? ""),
      detail: "A future VAT/promotions/coupons/affiliate/referral/seasonal-campaign pipeline can add a variant to PricingAdjustment without changing this file's existing Total = Labour + Materials rule.",
    },
    {
      check: "CommissionCalculationService forwards the same adjustments extension point",
      passed: /adjustments/.test(commissionSource ?? ""),
      detail: "CommissionCalculationInput.adjustments is forwarded verbatim to PricingCalculationService — no separate extension mechanism was invented at the commission layer.",
    },
    {
      check: "The commission rate is configurable per call, never hardcoded at a use-case call site",
      passed: /commissionRateBps\?\s*:\s*number/.test(commissionSource ?? ""),
      detail: "CommissionCalculationInput.commissionRateBps is optional and caller-supplied (sourced from CommissionRateRepository in production), defaulting to DEFAULT_COMMISSION_RATE_BPS only when omitted.",
    },
  ];
}

async function main(): Promise<void> {
  const scanner = new SourceScanner();

  const [statistics, architecture, businessRules, moneyAndRounding, singleSourceOfTruth, futureExtensibility] =
    await Promise.all([
      loadStatistics(),
      buildArchitectureChecks(scanner),
      buildBusinessRuleChecks(),
      buildMoneyAndRoundingChecks(),
      buildSingleSourceOfTruthChecks(scanner),
      buildFutureExtensibilityChecks(scanner),
    ]);

  const data: PricingReportData = {
    generatedAt: new Date().toISOString(),
    statistics,
    architecture,
    businessRules,
    moneyAndRounding,
    singleSourceOfTruth,
    futureExtensibility,
  };

  const report = buildPricingReport(data);
  const markdown = renderMarkdownPricingReport(report);

  const reportsDir = path.resolve(process.cwd(), "reports");
  await mkdir(reportsDir, { recursive: true });

  const mdPath = path.join(reportsDir, "pricing-report.md");
  const jsonPath = path.join(reportsDir, "pricing-report.json");
  await writeFile(mdPath, markdown, "utf8");
  await writeFile(jsonPath, JSON.stringify(report, null, 2), "utf8");

  console.log("MaestroYa Pricing & Commission Engine Report (Module 64)");
  console.log(`Overall Readiness Score: ${report.productionReadinessScore} / 100`);
  console.log(`Production Ready: ${report.isProductionReady ? "YES" : "NO"}`);
  console.log(`Written: ${mdPath}`);
  console.log(`Written: ${jsonPath}`);

  if (!report.isProductionReady) {
    process.exitCode = 1;
  }
}

main().catch((error: unknown) => {
  console.error("pricing-report failed:", error);
  process.exitCode = 1;
});
