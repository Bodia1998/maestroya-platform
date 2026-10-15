import { GenerateLegacyWindDownReportUseCase } from "@/application/use-cases/legacy-wind-down/generate-legacy-wind-down-report.use-case";
import { PrismaLegacyWindDownReader } from "@/infrastructure/database/prisma/repositories/prisma-legacy-wind-down-reader";

/**
 * Module 166 — composition root of the legacy wind-down report (plain factory, no DI container).
 *
 * TRUSTED-INTERNAL and READ-ONLY. Nothing in the application calls this: no route, Server Action, webhook, cron job, queue or
 * scheduler (pinned by a static test) — only `scripts/run-legacy-wind-down-report.ts`. It reads no environment variable and adds
 * no feature flag or switch. See docs/MODULE_166_LEGACY_WIND_DOWN_FINAL_SETTLEMENT.md.
 */
export function makeGenerateLegacyWindDownReportUseCase() {
  return new GenerateLegacyWindDownReportUseCase(new PrismaLegacyWindDownReader());
}
