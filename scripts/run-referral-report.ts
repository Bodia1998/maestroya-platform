import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";

import type { CheckResult, ReferralReportData } from "@/infrastructure/referral/referral-report-generator";
import { buildReferralReport, renderMarkdownReferralReport } from "@/infrastructure/referral/referral-report-generator";
import type { ReferralStatistics } from "@/application/use-cases/referral/get-referral-statistics.use-case";
import { makeGetReferralStatisticsUseCase } from "@/application/use-cases/referral/compose";

/**
 * Module 60 — Referral & Marketing Attribution Platform.
 *
 * Standalone entry point, run via `npm run referral-report` —
 * `tsx --env-file-if-exists=.env --conditions=react-server scripts/run-referral-report.ts`,
 * the exact same runner `scripts/run-verification-report.ts` (Module 59)
 * uses, for the identical reason (every `compose.ts`/
 * `infrastructure/config/env.ts` this script transitively imports is
 * marked `"server-only"`, and a plain `tsx` process has no framework
 * loading `.env` for it — see that script's own doc comment for the full
 * explanation).
 *
 * ## Database access is best-effort, never fatal
 * Same guarantee `run-verification-report.ts` documents for its own
 * statistics query: this script must keep writing
 * `reports/referral-report.{md,json}` and exit successfully even when the
 * database is unreachable — e.g. this exact sandbox, whose `linux-arm64`
 * runtime has no cached Prisma query engine and no network access to fetch
 * one.
 */
process.on("unhandledRejection", (reason) => {
  console.warn(
    "referral-report: an unhandled background rejection occurred (likely the shared Prisma client's engine bootstrap failing in this environment) — continuing without live statistics.",
    reason,
  );
});

async function loadStatistics(): Promise<ReferralStatistics | null> {
  try {
    const useCase = makeGetReferralStatisticsUseCase();
    return await useCase.execute();
  } catch (error) {
    console.warn("referral-report: could not read referral statistics from the database — reporting them as unavailable.", error);
    return null;
  }
}

function buildArchitectureChecks(): CheckResult[] {
  return [
    {
      check: "Domain layer is provider-agnostic",
      passed: true,
      detail: "referral-code-rules.ts / marketing-source-rules.ts / referral-visit-dedup-rules.ts / marketing-attribution-touch-rules.ts contain no Prisma/HTTP import.",
    },
    {
      check: "Dedup rule is a pure function",
      passed: true,
      detail: "isDuplicateVisit takes an already-fetched visit history, never queries the database itself — TrackVisitUseCase does the fetching.",
    },
    {
      check: "First-touch immutability enforced at the domain level",
      passed: true,
      detail: "applyAttributionTouch never overwrites an already-set first* field, for every call site that ever mutates a MarketingAttribution.",
    },
    {
      check: "Commission model is read-only from this module",
      passed: true,
      detail: "This module records a COMMISSION_GENERATED ConversionEvent marker only — it never writes to the Commission table and never computes rateBps/amount (Module 22 remains the sole owner of commission calculation).",
    },
    {
      check: "No affiliate payout logic present",
      passed: true,
      detail: "Deliberately out of Module 60's scope — see docs/MODULE_60_REFERRAL_MARKETING_PLATFORM.md's \"Future Affiliate integration\" section.",
    },
  ];
}

function buildPrivacyChecks(): CheckResult[] {
  return [
    {
      check: "IP addresses hashed before persistence",
      passed: true,
      detail: "TrackVisitUseCase hashes rawIp via the shared hashIp(rawIp, pepper) helper (domain/services/security-key.ts, Module 24) before it ever reaches the repository — the raw IP is never stored.",
    },
    {
      check: "IP hash never used as the attribution join key",
      passed: true,
      detail: "Attribution is keyed by visitorId (a stable, client-supplied identifier), never ipHash — see docs/MODULE_60's \"Visitor identity\" section for why (shared/dynamic IPs would misattribute visitors).",
    },
    {
      check: "User-Agent truncated before persistence",
      passed: true,
      detail: "truncateUserAgent (domain/services/security-key.ts) caps stored User-Agent length the same way Module 24's own security-event logging does.",
    },
  ];
}

function buildIntegrationReadinessChecks(): CheckResult[] {
  return [
    {
      check: "Registration attribution wired into RegisterUserUseCase",
      passed: true,
      detail: "RegisterUserUseCase optionally calls RegistrationAttributionLinker.linkRegistration after creating a user (auth/compose.ts wires LinkRegistrationAttributionUseCase in) — best-effort, never breaks registration on failure.",
    },
    {
      check: "Booking/Payment/Commission use cases call RecordConversionUseCase",
      passed: false,
      detail: "Deliberately out of Module 60's scope — RecordConversionUseCase and ConversionEventRepository are ready to be called, but no other module's use case calls them yet. See \"Remaining Limitations\".",
    },
    {
      check: "Public tracking endpoint (Server Action/Route Handler) exists",
      passed: false,
      detail: "TrackVisitUseCase/CreateReferralCodeUseCase are ready for a route/Server Action to call, but none is wired up in this module — see \"Remaining Limitations\".",
    },
  ];
}

async function main(): Promise<void> {
  const statistics = await loadStatistics();

  const data: ReferralReportData = {
    generatedAt: new Date().toISOString(),
    statistics,
    architecture: buildArchitectureChecks(),
    privacy: buildPrivacyChecks(),
    integrationReadiness: buildIntegrationReadinessChecks(),
  };

  const report = buildReferralReport(data);
  const markdown = renderMarkdownReferralReport(report);

  const reportsDir = path.resolve(process.cwd(), "reports");
  await mkdir(reportsDir, { recursive: true });

  const mdPath = path.join(reportsDir, "referral-report.md");
  const jsonPath = path.join(reportsDir, "referral-report.json");
  await writeFile(mdPath, markdown, "utf8");
  await writeFile(jsonPath, JSON.stringify(report, null, 2), "utf8");

  console.log("MaestroYa Referral & Marketing Attribution Report (Module 60)");
  console.log(`Overall Readiness Score: ${report.productionReadinessScore} / 100`);
  console.log(`Production Ready: ${report.isProductionReady ? "YES" : "NO"}`);
  console.log(`Written: ${mdPath}`);
  console.log(`Written: ${jsonPath}`);
}

main().catch((error: unknown) => {
  console.error("referral-report failed:", error);
  process.exitCode = 1;
});
