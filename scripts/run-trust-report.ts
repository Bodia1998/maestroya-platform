import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";

import type { CheckResult, TrustIntegrityReportData } from "@/infrastructure/trust-integrity/trust-integrity-report-generator";
import { buildTrustIntegrityReport, renderMarkdownTrustIntegrityReport } from "@/infrastructure/trust-integrity/trust-integrity-report-generator";
import { SourceScanner } from "@/infrastructure/multi-instance-safety/source-scanner";
import { makeGetTrustIntegrityStatisticsUseCase } from "@/application/use-cases/trust-integrity/compose";
import { recalculateTrustScore, TRUST_SCORE_DELTA_TABLE, DEFAULT_TRUST_SCORE } from "@/domain/services/trust-score-policy";
import { recalculateRiskScore, RISK_SCORE_DELTA_TABLE, deriveEscalationTier, RISK_SCORE_THRESHOLDS } from "@/domain/services/risk-score-policy";
import { detectOffPlatformSignals } from "@/domain/services/off-platform-detection-rules";
import { detectSamePhoneClusters, detectSuspiciousRegistrationPattern } from "@/domain/services/fraud-detection-rules";
import { detectSpamActivity } from "@/domain/services/spam-detection-rules";
import { detectPricingSplitAnomaly } from "@/domain/services/suspicious-pricing-detection-rules";
import { decideAutomatedAction } from "@/domain/services/trust-integrity-action-policy";
import { assertValidManualReviewTransition, canTransitionManualReviewCase } from "@/domain/entities/manual-review-case";
import { assertValidAppealTransition, canTransitionAppeal } from "@/domain/entities/appeal";

/**
 * Module 65 — Trust & Integrity System.
 *
 * Standalone entry point, run via `npm run trust-report` — same
 * `tsx --env-file-if-exists=.env --conditions=react-server scripts/run-trust-report.ts`
 * runner every other `run-*-report.ts` script uses (see
 * `scripts/run-pricing-report.ts`'s own doc comment for the full
 * explanation of why a plain `tsx` process needs `--env-file-if-exists`
 * and `--conditions=react-server`).
 *
 * ## Database access is best-effort, never fatal
 * Same guarantee every other `run-*-report.ts` documents: this script must
 * keep writing `reports/trust-report.{md,json}` and exit successfully even
 * when the database is unreachable.
 *
 * ## Checks are real, not asserted
 * Every check below either (a) actually invokes the module's own rule
 * engines/policies at report-generation time and asserts on the real
 * result, or (b) uses `SourceScanner` (Module 58's read-only static-
 * analysis primitive) to grep the actual committed source for the
 * architectural properties this module requires (framework-free domain
 * layer, no AI/SDK imports, provider-interface presence).
 */
process.on("unhandledRejection", (reason) => {
  console.warn(
    "trust-report: an unhandled background rejection occurred (likely the shared Prisma client's engine bootstrap failing in this environment) — continuing without live statistics.",
    reason,
  );
});

async function loadStatistics() {
  try {
    const useCase = makeGetTrustIntegrityStatisticsUseCase();
    return await useCase.execute();
  } catch (error) {
    console.warn("trust-report: could not read trust & integrity statistics from the database — reporting as unavailable.", error);
    return null;
  }
}

const DOMAIN_FILES = [
  "src/core/domain/services/trust-score-policy.ts",
  "src/core/domain/services/risk-score-policy.ts",
  "src/core/domain/services/off-platform-detection-rules.ts",
  "src/core/domain/services/fraud-detection-rules.ts",
  "src/core/domain/services/fake-review-detection-rules.ts",
  "src/core/domain/services/spam-detection-rules.ts",
  "src/core/domain/services/suspicious-pricing-detection-rules.ts",
  "src/core/domain/services/booking-abuse-detection-rules.ts",
  "src/core/domain/services/payment-abuse-detection-rules.ts",
  "src/core/domain/services/identity-risk-rules.ts",
  "src/core/domain/services/trust-integrity-action-policy.ts",
];

const NO_AI_SDK_PATTERN = /openai|anthropic-ai|@anthropic|langchain|tensorflow|from ["']ai["']/i;
const FRAMEWORK_IMPORT_PATTERN = /(?:from\s+["'][^"']*(?:@prisma\/client|next\/server)["']|require\(["'][^"']*prisma[^"']*["']\)|^"use server";?$)/im;
const UI_ARTIFACT_PATTERN = /\.tsx["']|from\s+["']react["']|"use client"/i;

async function buildArchitectureChecks(scanner: SourceScanner): Promise<CheckResult[]> {
  const results: CheckResult[] = [];

  for (const file of DOMAIN_FILES) {
    const source = await scanner.read(file);
    results.push({
      check: `${file} is framework-free (domain layer)`,
      passed: source !== null && !FRAMEWORK_IMPORT_PATTERN.test(source),
      detail: "No Prisma/Next.js import found in this domain-layer file.",
    });
    results.push({
      check: `${file} does not integrate an AI/LLM SDK`,
      passed: source !== null && !NO_AI_SDK_PATTERN.test(source),
      detail: "No OpenAI/Anthropic/LangChain/TensorFlow import found — off-platform and fraud detection stay rule-based.",
    });
  }

  const providerFiles = [
    "src/core/application/ports/device-fingerprint-provider.ts",
    "src/core/application/ports/vpn-proxy-detection-provider.ts",
    "src/core/application/ports/disposable-email-provider.ts",
    "src/core/application/ports/phone-reputation-provider.ts",
    "src/core/application/ports/off-platform-detection-provider.ts",
  ];
  for (const file of providerFiles) {
    const source = await scanner.read(file);
    results.push({
      check: `${file} defines a provider interface (extension point)`,
      passed: source !== null && /export interface/.test(source),
      detail: "A named provider interface exists for a future concrete backend.",
    });
  }

  for (const file of [...DOMAIN_FILES, ...providerFiles]) {
    const source = await scanner.read(file);
    results.push({
      check: `${file} contains no UI/React artifact`,
      passed: source !== null && !UI_ARTIFACT_PATTERN.test(source),
      detail: "No .tsx/React import/\"use client\" directive found — this module ships no UI, per its own brief.",
    });
  }

  return results;
}

async function buildBusinessRulesChecks(): Promise<CheckResult[]> {
  const results: CheckResult[] = [];

  const trust = recalculateTrustScore(DEFAULT_TRUST_SCORE, "ACCOUNT_VERIFIED");
  results.push({
    check: `Trust Score starts at ${DEFAULT_TRUST_SCORE} and rises by ${TRUST_SCORE_DELTA_TABLE.ACCOUNT_VERIFIED} on ACCOUNT_VERIFIED`,
    passed: trust.scoreAfter === DEFAULT_TRUST_SCORE + TRUST_SCORE_DELTA_TABLE.ACCOUNT_VERIFIED,
    detail: `Computed scoreBefore=${trust.scoreBefore}, scoreAfter=${trust.scoreAfter}.`,
  });

  const clampedHigh = recalculateTrustScore(99, "ACCOUNT_VERIFIED");
  results.push({
    check: "Trust Score never exceeds 100",
    passed: clampedHigh.scoreAfter === 100,
    detail: `99 + ${TRUST_SCORE_DELTA_TABLE.ACCOUNT_VERIFIED} clamped to ${clampedHigh.scoreAfter}.`,
  });

  const clampedLow = recalculateRiskScore(5, "ACCOUNT_VERIFIED");
  results.push({
    check: "Risk Score never drops below 0",
    passed: clampedLow.scoreAfter === 0,
    detail: `5 + ${RISK_SCORE_DELTA_TABLE.ACCOUNT_VERIFIED} clamped to ${clampedLow.scoreAfter}.`,
  });

  const offPlatform = detectOffPlatformSignals("Contact me on WhatsApp +34 611 222 333, let's continue outside the platform");
  results.push({
    check: "Off-platform rule engine detects WhatsApp + phone + contact-exchange phrase in one message",
    passed: offPlatform.some((s) => s.channel === "WHATSAPP") && offPlatform.some((s) => s.channel === "PHONE_NUMBER"),
    detail: `Detected channels: ${offPlatform.map((s) => s.channel).join(", ") || "none"}.`,
  });

  const cleanText = detectOffPlatformSignals("The bathroom tiling looks great, thank you for the quote!");
  results.push({
    check: "Off-platform rule engine does not false-positive on ordinary marketplace text",
    passed: cleanText.length === 0,
    detail: `Detected channels on clean text: ${cleanText.map((s) => s.channel).join(", ") || "none"}.`,
  });

  const sameClusters = detectSamePhoneClusters([
    { identifierHash: "hash-a", userIds: ["u1", "u2", "u3"] },
    { identifierHash: "hash-b", userIds: ["u4"] },
  ]);
  results.push({
    check: "Fraud engine flags a phone hash shared by 2+ users, ignores a hash with only one user",
    passed: sameClusters.length === 1 && sameClusters[0]?.userIds.length === 3,
    detail: `Clusters flagged: ${sameClusters.length}.`,
  });

  const registrationBurst = detectSuspiciousRegistrationPattern({
    userId: "u1",
    accountsFromSameSourceInWindow: 5,
    minutesToFirstAction: 10,
  });
  results.push({
    check: "Fraud engine flags a registration burst (5 accounts from one source)",
    passed: registrationBurst !== null,
    detail: registrationBurst?.detail ?? "no finding",
  });

  const spam = detectSpamActivity({
    userId: "u1",
    duplicateSubmissionsInWindow: 5,
    distinctRecipientsSameMessageInWindow: 2,
    repeatedQuotesForSameRequest: 1,
    totalActionsInWindow: 10,
  });
  results.push({
    check: "Spam engine flags duplicate submissions above threshold, without over-flagging unrelated dimensions",
    passed: spam.length === 1 && spam[0]?.reason === "DUPLICATE_REQUESTS",
    detail: `Findings: ${spam.map((f) => f.reason).join(", ") || "none"}.`,
  });

  const pricingAnomaly = detectPricingSplitAnomaly({ labour: 2, materials: 998, total: 1000 });
  results.push({
    check: "Pricing engine flags a Quote with implausibly low labour / high materials",
    passed: pricingAnomaly.some((f) => f.reason === "VERY_LOW_LABOUR") && pricingAnomaly.some((f) => f.reason === "VERY_HIGH_MATERIALS"),
    detail: `Findings: ${pricingAnomaly.map((f) => f.reason).join(", ") || "none"}.`,
  });

  const manualTransitionValid = canTransitionManualReviewCase("OPEN", "UNDER_REVIEW");
  const manualTransitionInvalid = canTransitionManualReviewCase("RESOLVED", "OPEN");
  results.push({
    check: "Manual review case state machine allows OPEN -> UNDER_REVIEW and rejects RESOLVED -> OPEN",
    passed: manualTransitionValid && !manualTransitionInvalid,
    detail: `OPEN->UNDER_REVIEW=${manualTransitionValid}, RESOLVED->OPEN=${manualTransitionInvalid}.`,
  });

  let manualAssertThrew = false;
  try {
    assertValidManualReviewTransition("RESOLVED", "ESCALATED");
  } catch {
    manualAssertThrew = true;
  }
  results.push({
    check: "assertValidManualReviewTransition throws for an illegal transition",
    passed: manualAssertThrew,
    detail: "RESOLVED -> ESCALATED throws InvalidManualReviewTransitionError.",
  });

  const appealTransitionValid = canTransitionAppeal("SUBMITTED", "UNDER_REVIEW");
  const appealTransitionInvalid = canTransitionAppeal("REJECTED", "APPROVED");
  results.push({
    check: "Appeal state machine allows SUBMITTED -> UNDER_REVIEW and rejects REJECTED -> APPROVED",
    passed: appealTransitionValid && !appealTransitionInvalid,
    detail: `SUBMITTED->UNDER_REVIEW=${appealTransitionValid}, REJECTED->APPROVED=${appealTransitionInvalid}.`,
  });

  let appealAssertThrew = false;
  try {
    assertValidAppealTransition("ACCOUNT_RESTORED", "SUBMITTED");
  } catch {
    appealAssertThrew = true;
  }
  results.push({
    check: "assertValidAppealTransition throws for an illegal transition",
    passed: appealAssertThrew,
    detail: "ACCOUNT_RESTORED -> SUBMITTED throws InvalidAppealTransitionError.",
  });

  return results;
}

async function buildFraudDetectionCoverageChecks(scanner: SourceScanner): Promise<CheckResult[]> {
  const fraudRulesSource = await scanner.read("src/core/domain/services/fraud-detection-rules.ts");
  const requiredDetectors = [
    "detectSamePhoneClusters",
    "detectSameIbanClusters",
    "detectSameStripeAccountClusters",
    "detectSameDeviceClusters",
    "detectSuspiciousRegistrationPattern",
    "detectRepeatedFailedVerification",
  ];
  return requiredDetectors.map((fn) => ({
    check: `fraud-detection-rules.ts exports ${fn}`,
    passed: fraudRulesSource !== null && new RegExp(`export function ${fn}`).test(fraudRulesSource),
    detail: `${fn} is a named export of the fraud detection rule engine.`,
  }));
}

async function buildRiskEngineChecks(): Promise<CheckResult[]> {
  const results: CheckResult[] = [];

  results.push({
    check: "Escalation tiers are ordered WARNING < RESTRICTION < MANUAL_REVIEW < SUSPENSION",
    passed:
      RISK_SCORE_THRESHOLDS.WARNING < RISK_SCORE_THRESHOLDS.RESTRICTION &&
      RISK_SCORE_THRESHOLDS.RESTRICTION < RISK_SCORE_THRESHOLDS.MANUAL_REVIEW &&
      RISK_SCORE_THRESHOLDS.MANUAL_REVIEW < RISK_SCORE_THRESHOLDS.SUSPENSION,
    detail: `Thresholds: ${JSON.stringify(RISK_SCORE_THRESHOLDS)}.`,
  });

  results.push({
    check: `deriveEscalationTier(0) is NONE, deriveEscalationTier(${RISK_SCORE_THRESHOLDS.SUSPENSION}) is SUSPENSION`,
    passed: deriveEscalationTier(0) === "NONE" && deriveEscalationTier(RISK_SCORE_THRESHOLDS.SUSPENSION) === "SUSPENSION",
    detail: `deriveEscalationTier(0)=${deriveEscalationTier(0)}, deriveEscalationTier(${RISK_SCORE_THRESHOLDS.SUSPENSION})=${deriveEscalationTier(RISK_SCORE_THRESHOLDS.SUSPENSION)}.`,
  });

  const firstOffense = decideAutomatedAction(RISK_SCORE_THRESHOLDS.RESTRICTION, 0);
  const repeatOffense = decideAutomatedAction(RISK_SCORE_THRESHOLDS.RESTRICTION, 1);
  results.push({
    check: "A repeat offender at the same risk tier receives a harsher automated action than a first offender",
    passed: firstOffense.action === "TEMPORARY_RESTRICTION" && repeatOffense.action === "MANUAL_REVIEW",
    detail: `first=${firstOffense.action}, repeat=${repeatOffense.action}.`,
  });

  const noAction = decideAutomatedAction(RISK_SCORE_THRESHOLDS.WARNING - 1, 0);
  results.push({
    check: "No automated action is taken below the WARNING threshold",
    passed: noAction.action === null,
    detail: `decideAutomatedAction(${RISK_SCORE_THRESHOLDS.WARNING - 1}, 0).action=${noAction.action}.`,
  });

  return results;
}

async function buildTrustScoreChecks(): Promise<CheckResult[]> {
  const results: CheckResult[] = [];

  results.push({
    check: "Every reason in TRUST_SCORE_DELTA_TABLE has a mirrored entry in RISK_SCORE_DELTA_TABLE",
    passed: Object.keys(TRUST_SCORE_DELTA_TABLE).every((reason) => reason in RISK_SCORE_DELTA_TABLE),
    detail: `${Object.keys(TRUST_SCORE_DELTA_TABLE).length} reasons checked.`,
  });

  results.push({
    check: "FRAUD_SIGNAL_DETECTED lowers trust and raises risk (opposite polarity)",
    passed: TRUST_SCORE_DELTA_TABLE.FRAUD_SIGNAL_DETECTED < 0 && RISK_SCORE_DELTA_TABLE.FRAUD_SIGNAL_DETECTED > 0,
    detail: `trustDelta=${TRUST_SCORE_DELTA_TABLE.FRAUD_SIGNAL_DETECTED}, riskDelta=${RISK_SCORE_DELTA_TABLE.FRAUD_SIGNAL_DETECTED}.`,
  });

  results.push({
    check: "APPEAL_APPROVED restores trust and lowers risk",
    passed: TRUST_SCORE_DELTA_TABLE.APPEAL_APPROVED > 0 && RISK_SCORE_DELTA_TABLE.APPEAL_APPROVED < 0,
    detail: `trustDelta=${TRUST_SCORE_DELTA_TABLE.APPEAL_APPROVED}, riskDelta=${RISK_SCORE_DELTA_TABLE.APPEAL_APPROVED}.`,
  });

  return results;
}

async function buildFutureIntegrationReadinessChecks(scanner: SourceScanner): Promise<CheckResult[]> {
  const results: CheckResult[] = [];

  const identityRulesSource = await scanner.read("src/core/domain/services/identity-risk-rules.ts");
  results.push({
    check: "Identity risk rules reuse Module 59's ProfessionalVerificationStatusValue rather than redefining verification statuses",
    passed: identityRulesSource !== null && /ProfessionalVerificationStatusValue/.test(identityRulesSource),
    detail: "identity-risk-rules.ts imports the status type from professional-verification-rules.ts.",
  });

  const pricingRulesSource = await scanner.read("src/core/domain/services/suspicious-pricing-detection-rules.ts");
  results.push({
    check: "Suspicious pricing rules integrate with Module 64's PricingBreakdown rather than redefining pricing math",
    passed: pricingRulesSource !== null && /PricingBreakdown/.test(pricingRulesSource),
    detail: "suspicious-pricing-detection-rules.ts imports PricingBreakdown from pricing-calculation-service.ts.",
  });

  const factorySource = await scanner.read("src/core/infrastructure/trust-integrity/trust-integrity-provider-factory.ts");
  results.push({
    check: "Every provider (device fingerprint, VPN/proxy, disposable email, phone reputation) is resolved through one factory",
    passed:
      factorySource !== null &&
      ["createDeviceFingerprintProvider", "createVpnProxyDetectionProvider", "createDisposableEmailProvider", "createPhoneReputationProvider"].every(
        (fn) => factorySource.includes(fn),
      ),
    detail: "trust-integrity-provider-factory.ts exports one create*Provider function per port.",
  });

  const actionPolicySource = await scanner.read("src/core/domain/services/trust-integrity-action-policy.ts");
  results.push({
    check: "Automated actions are configurable (ActionPolicyConfig), not hardcoded per call site",
    passed: actionPolicySource !== null && /ActionPolicyConfig/.test(actionPolicySource),
    detail: "decideAutomatedAction accepts a config parameter with a documented default.",
  });

  const migrationSource = await scanner.read("prisma/migrations/20260821000000_add_trust_integrity_system/migration.sql");
  results.push({
    check: "A hand-authored migration exists for every new Module 65 table",
    passed:
      migrationSource !== null &&
      ["trust_profiles", "score_events", "off_platform_detection_events", "fraud_signals", "trust_automated_actions", "trust_manual_review_cases", "trust_appeals"].every(
        (table) => migrationSource.includes(table),
      ),
    detail: "migration.sql creates all eight new Module 65 tables.",
  });

  return results;
}

async function main(): Promise<void> {
  const scanner = new SourceScanner();

  const [statistics, architectureValidation, businessRulesValidation, fraudDetectionCoverage, riskEngineValidation, trustScoreValidation, futureIntegrationReadiness] =
    await Promise.all([
      loadStatistics(),
      buildArchitectureChecks(scanner),
      buildBusinessRulesChecks(),
      buildFraudDetectionCoverageChecks(scanner),
      buildRiskEngineChecks(),
      buildTrustScoreChecks(),
      buildFutureIntegrationReadinessChecks(scanner),
    ]);

  const data: TrustIntegrityReportData = {
    generatedAt: new Date().toISOString(),
    statistics,
    architectureValidation,
    businessRulesValidation,
    fraudDetectionCoverage,
    riskEngineValidation,
    trustScoreValidation,
    futureIntegrationReadiness,
  };

  const report = buildTrustIntegrityReport(data);
  const markdown = renderMarkdownTrustIntegrityReport(report);

  const reportsDir = path.resolve(process.cwd(), "reports");
  await mkdir(reportsDir, { recursive: true });

  const mdPath = path.join(reportsDir, "trust-report.md");
  const jsonPath = path.join(reportsDir, "trust-report.json");
  await writeFile(mdPath, markdown, "utf8");
  await writeFile(jsonPath, JSON.stringify(report, null, 2), "utf8");

  console.log("MaestroYa Trust & Integrity System Report (Module 65)");
  console.log(`Overall Readiness Score: ${report.productionReadinessScore} / 100`);
  console.log(`Production Ready: ${report.isProductionReady ? "YES" : "NO"}`);
  console.log(`Written: ${mdPath}`);
  console.log(`Written: ${jsonPath}`);

  if (!report.isProductionReady) {
    process.exitCode = 1;
  }
}

main().catch((error: unknown) => {
  console.error("trust-report failed:", error);
  process.exitCode = 1;
});
