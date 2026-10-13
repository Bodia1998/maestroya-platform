/**
 * Module 161 — LEAD_V1 repeatable workload profile (baseline measurement) against a disposable local PostgreSQL.
 *
 * OPT-IN: skipped unless `M161_LOAD=1` (so `npm run test:integration:db` stays fast). Run with `npm run test:load:m161`.
 * It runs only through `vitest.config.integration-db.ts`, i.e. only against the database accepted by `resolveTestDatabaseUrl()`
 * (loopback / Docker host names, never a managed provider such as Supabase). It never touches Stripe (in-memory provider) or
 * e-mail, and uses synthetic `.invalid` identities.
 *
 * WHAT THIS MEASURES: the application + repository + database path of the LEAD_V1 flow, called IN-PROCESS through the real
 * composition roots (and the real webhook route handler function). It does NOT include an HTTP server, network, TLS, Next.js
 * rendering, Server Action / session overhead, a real Stripe call, a CDN, or production-like data volume. Numbers are a
 * BASELINE for this machine and this client; they say nothing about production capacity. No pass/fail latency threshold is
 * asserted (none is defined by the project - see the Gate B document); only INVARIANTS are asserted.
 *
 * Results are printed and written as JSON to `M161_LOAD_OUT` (default `reports/m161-load-baseline.json`, a git-ignored folder).
 */
import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/infrastructure/observability/logger", () => ({
  logger: { warn: vi.fn(), info: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));
vi.mock("@/infrastructure/payments/stripe/stripe-lead-fee-payment-gateway", async () => {
  const { m161Gateway } = await import("../../test-utils/m161-lead-v1-world");
  return {
    StripeLeadFeePaymentGatewayAdapter: class {
      constructor() {
        return m161Gateway.current;
      }
    },
  };
});
vi.mock("@/infrastructure/email/resend-email-sender", () => ({
  ResendEmailSender: class {
    async send(): Promise<void> {}
  },
}));

import { POST as stripePaymentsWebhook } from "@/app/api/webhooks/stripe-payments/route";
import { makeInitiateLeadFeePaymentUseCase } from "@/application/use-cases/lead-fee-payment/compose";
import { makeGetLeadFeedForProfessionalUseCase } from "@/application/use-cases/lead/compose";
import { makeInitiateLeadPurchaseUseCase } from "@/application/use-cases/lead-purchase/compose";
import { makeSubmitLeadRequestUseCase } from "@/application/use-cases/lead-request/compose";
import { LeadV1RolloutDisabledError } from "@/domain/services/lead-rollout";
import { prisma } from "@/infrastructure/database/prisma/client";

import { setupDbTestLifecycle } from "../../test-utils/db/db-test-lifecycle";
import { withContentionProbe, type ContentionEvidence } from "../../test-utils/m161-contention-probe";
import { PILOT_PRICING, PILOT_TOTAL_MINOR_UNITS, seedProfessionals, submitPublishedLead } from "../../test-utils/m161-lead-v1-flows";
import { REQUEST_INPUT, m161Gateway, paymentIntentEvent, resetM161Gateway, seedCategory, seedCustomer, signedWebhookRequest, webhookOutcome } from "../../test-utils/m161-lead-v1-world";

/** The fixed workload profile. Changing any number changes the baseline - record it in the report if you do. */
const PROFILE = {
  professionals: 40,
  feedLeads: 50,
  feedRequests: 400,
  feedConcurrency: 20,
  submissions: 120,
  submitConcurrency: 10,
  contendedLeads: 25,
  contendersPerLead: 8,
  purchaseConcurrency: 24,
  paymentConcurrency: 10,
  paymentDuplicatesPerPurchase: 2,
  webhookSameIdRepeats: 3,
  webhookDistinctIdRepeats: 2,
  webhookConcurrency: 20,
  guardRejectionRequests: 300,
  guardConcurrency: 20,
  operationTimeoutMs: 30_000,
} as const;

interface Sample {
  ms: number;
  result: "success" | "expected_refusal" | "timeout" | "error";
}

interface ScenarioResult {
  name: string;
  concurrency: number;
  requests: number;
  success: number;
  expectedRefusals: number;
  timeouts: number;
  unexpectedErrors: number;
  wallMs: number;
  throughputPerSec: number;
  latencyMs: { p50: number; p95: number; p99: number; max: number };
  dbContention: ContentionEvidence | null;
  invariantViolations: string[];
}

function percentile(sorted: number[], p: number): number {
  if (sorted.length === 0) return 0;
  const index = Math.min(sorted.length - 1, Math.ceil((p / 100) * sorted.length) - 1);
  return Math.round(sorted[Math.max(0, index)]! * 10) / 10;
}

async function runPool<T>(tasks: Array<() => Promise<T>>, concurrency: number): Promise<Array<{ ok: true; value: T; ms: number } | { ok: false; error: unknown; ms: number }>> {
  const results = new Array<{ ok: true; value: T; ms: number } | { ok: false; error: unknown; ms: number }>(tasks.length);
  let next = 0;
  const worker = async () => {
    for (;;) {
      const index = next;
      next += 1;
      if (index >= tasks.length) return;
      const started = performance.now();
      try {
        const value = await Promise.race([
          tasks[index]!(),
          new Promise<never>((_, reject) => setTimeout(() => reject(new Error("M161_TIMEOUT")), PROFILE.operationTimeoutMs).unref()),
        ]);
        results[index] = { ok: true, value, ms: performance.now() - started };
      } catch (error) {
        results[index] = { ok: false, error, ms: performance.now() - started };
      }
    }
  };
  await Promise.all(Array.from({ length: Math.min(concurrency, tasks.length) }, worker));
  return results;
}

const scenarios: ScenarioResult[] = [];

async function measure<T>(
  name: string,
  concurrency: number,
  tasks: Array<() => Promise<T>>,
  classify: (outcome: { ok: true; value: T } | { ok: false; error: unknown }) => Sample["result"],
  options: { probe?: boolean } = {},
): Promise<{ result: ScenarioResult; raw: Array<{ ok: true; value: T; ms: number } | { ok: false; error: unknown; ms: number }> }> {
  const started = performance.now();
  const run = () => runPool(tasks, concurrency);
  const { result: raw, evidence } = options.probe === false ? { result: await run(), evidence: null } : await withContentionProbe(run, 10);
  const wallMs = performance.now() - started;
  const classified = raw.map((r) => ({ ms: r.ms, result: classify(r) }));
  const latencies = classified.map((c) => c.ms).sort((a, b) => a - b);
  const result: ScenarioResult = {
    name,
    concurrency,
    requests: tasks.length,
    success: classified.filter((c) => c.result === "success").length,
    expectedRefusals: classified.filter((c) => c.result === "expected_refusal").length,
    timeouts: classified.filter((c) => c.result === "timeout").length,
    unexpectedErrors: classified.filter((c) => c.result === "error").length,
    wallMs: Math.round(wallMs),
    throughputPerSec: Math.round((tasks.length / (wallMs / 1000)) * 10) / 10,
    latencyMs: { p50: percentile(latencies, 50), p95: percentile(latencies, 95), p99: percentile(latencies, 99), max: Math.round((latencies.at(-1) ?? 0) * 10) / 10 },
    dbContention: evidence,
    invariantViolations: [],
  };
  scenarios.push(result);
  return { result, raw };
}

const isTimeout = (error: unknown) => error instanceof Error && error.message === "M161_TIMEOUT";

describe.skipIf(process.env.M161_LOAD !== "1")("Module 161 — LEAD_V1 workload profile (baseline, real PostgreSQL)", () => {
  setupDbTestLifecycle();

  const saved = { rollout: process.env.LEAD_V1_ROLLOUT_MODE, abuse: process.env.LEAD_ABUSE_CONTROL_MODE, basis: process.env.LEAD_CONTACT_SHARING_BASIS };
  beforeEach(() => {
    process.env.LEAD_V1_ROLLOUT_MODE = "ENABLED";
    delete process.env.LEAD_ABUSE_CONTROL_MODE;
    delete process.env.LEAD_CONTACT_SHARING_BASIS;
    resetM161Gateway();
  });
  afterEach(() => {
    for (const [key, value] of [["LEAD_V1_ROLLOUT_MODE", saved.rollout], ["LEAD_ABUSE_CONTROL_MODE", saved.abuse], ["LEAD_CONTACT_SHARING_BASIS", saved.basis]] as const) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  });

  it(
    "runs the fixed profile and asserts only invariants",
    async () => {
      scenarios.length = 0;
      const category = await seedCategory(prisma);
      const pros = await seedProfessionals(category, PROFILE.professionals);
      const poolMax = Number(process.env.M161_POOL_MAX ?? "") || null;

      // ---------------- S1: read-only marketplace feed
      const feedLeads: string[] = [];
      for (const batch of chunk(Array.from({ length: PROFILE.feedLeads }), 8)) {
        const made = await Promise.all(batch.map(() => submitPublishedLead(category)));
        feedLeads.push(...made.map((m) => m.lead.id));
      }
      const feedUc = makeGetLeadFeedForProfessionalUseCase();
      const s1 = await measure(
        "S1 marketplace feed (read-only)",
        PROFILE.feedConcurrency,
        Array.from({ length: PROFILE.feedRequests }, (_, i) => () => feedUc.execute(pros[i % pros.length]!.userId)),
        (o) => (o.ok ? "success" : isTimeout(o.error) ? "timeout" : "error"),
      );
      const feedPages = s1.raw.filter((r) => r.ok).map((r) => (r as { ok: true; value: Awaited<ReturnType<typeof feedUc.execute>> }).value);
      if (feedPages.some((p) => p.items.length > 20)) s1.result.invariantViolations.push("feed page larger than the default page size");
      if (feedPages.some((p) => JSON.stringify(p).includes("@test.maestroya.invalid"))) s1.result.invariantViolations.push("contact data present in a feed page");
      if (feedPages.some((p) => p.items.length === 0)) s1.result.invariantViolations.push("an eligible professional saw an empty feed");

      // ---------------- S2: request creation + estimation + pricing + publication
      const requestsBefore = await prisma.lead.count({ where: { status: "PUBLISHED" } });
      const customers = await Promise.all(Array.from({ length: PROFILE.submissions }, () => seedCustomer(prisma)));
      const s2 = await measure(
        "S2 submit request (create + estimate + price + publish)",
        PROFILE.submitConcurrency,
        customers.map((c) => () => makeSubmitLeadRequestUseCase(PILOT_PRICING()).execute(c.userId, REQUEST_INPUT(category.id))),
        (o) => (o.ok && o.value.publication === "PUBLISHED" ? "success" : o.ok ? "error" : isTimeout(o.error) ? "timeout" : "error"),
      );
      const published = (await prisma.lead.count({ where: { status: "PUBLISHED" } })) - requestsBefore;
      if (published !== s2.result.success) s2.result.invariantViolations.push(`published ${published} leads for ${s2.result.success} successful submissions`);
      if ((await prisma.lead.count({ where: { status: "PUBLISHED", maxBuyers: { not: 1 } } })) > 0) s2.result.invariantViolations.push("a published lead does not carry the pilot buyer policy");

      // ---------------- S3: contended purchases (maxBuyers = 1)
      const contended: string[] = [];
      for (const batch of chunk(Array.from({ length: PROFILE.contendedLeads }), 8)) {
        const made = await Promise.all(batch.map(() => submitPublishedLead(category)));
        contended.push(...made.map((m) => m.lead.id));
      }
      const tasks3: Array<() => Promise<unknown>> = [];
      contended.forEach((leadId, leadIndex) => {
        for (let k = 0; k < PROFILE.contendersPerLead; k += 1) {
          const pro = pros[(leadIndex + k) % pros.length]!;
          tasks3.push(() => makeInitiateLeadPurchaseUseCase().execute(pro.userId, leadId));
        }
      });
      shuffle(tasks3, 20261013);
      const s3 = await measure(
        "S3 contended purchase initiation (8 contenders per exclusive lead)",
        PROFILE.purchaseConcurrency,
        tasks3,
        (o) => (o.ok ? "success" : isTimeout(o.error) ? "timeout" : isDomainRefusal(o.error) ? "expected_refusal" : "error"),
      );
      for (const leadId of contended) {
        const active = await prisma.leadPurchase.count({ where: { leadId, status: { in: ["PENDING_PAYMENT", "CONFIRMED", "DISPUTED"] } } });
        const total = await prisma.leadPurchase.count({ where: { leadId } });
        if (active !== 1 || total !== 1) s3.result.invariantViolations.push(`lead ${leadId.slice(0, 8)}: active=${active} total=${total}`);
      }

      // ---------------- S4: payment initiation (+ duplicates)
      const winners = await prisma.leadPurchase.findMany({ where: { leadId: { in: contended }, status: "PENDING_PAYMENT" }, select: { id: true, professionalProfileId: true } });
      const userByProfile = new Map(pros.map((p) => [p.profileId, p.userId]));
      const tasks4: Array<() => Promise<unknown>> = [];
      for (const w of winners) {
        for (let k = 0; k <= PROFILE.paymentDuplicatesPerPurchase; k += 1) tasks4.push(() => makeInitiateLeadFeePaymentUseCase().execute(userByProfile.get(w.professionalProfileId)!, w.id));
      }
      shuffle(tasks4, 20261014);
      const s4 = await measure("S4 lead-fee payment initiation (each purchase 3x, concurrent)", PROFILE.paymentConcurrency, tasks4, (o) => (o.ok ? "success" : isTimeout(o.error) ? "timeout" : "error"));
      const gateway = m161Gateway.current;
      const refs = await prisma.leadPurchase.findMany({ where: { id: { in: winners.map((w) => w.id) } }, select: { id: true, paymentReference: true } });
      if (refs.some((r) => !r.paymentReference)) s4.result.invariantViolations.push("a purchase has no payment reference");
      if (new Set(refs.map((r) => r.paymentReference)).size !== winners.length) s4.result.invariantViolations.push("payment references are not unique per purchase");
      if (gateway.payments.size !== winners.length) s4.result.invariantViolations.push(`provider holds ${gateway.payments.size} payments for ${winners.length} purchases`);

      // ---------------- S5: webhook confirmation incl. duplicates
      const tasks5: Array<() => Promise<{ http: number; status: string | null }>> = [];
      for (const r of refs) {
        const base = { paymentIntentId: r.paymentReference!, amountMinorUnits: PILOT_TOTAL_MINOR_UNITS, leadPurchaseId: r.id };
        const sameId = paymentIntentEvent(base);
        for (let k = 0; k < PROFILE.webhookSameIdRepeats; k += 1) tasks5.push(async () => webhookOutcome(await stripePaymentsWebhook(signedWebhookRequest(sameId))));
        for (let k = 0; k < PROFILE.webhookDistinctIdRepeats; k += 1) tasks5.push(async () => webhookOutcome(await stripePaymentsWebhook(signedWebhookRequest(paymentIntentEvent(base)))));
      }
      shuffle(tasks5, 20261015);
      const s5 = await measure("S5 signed webhook deliveries (5 per purchase: 3 same event id + 2 distinct ids)", PROFILE.webhookConcurrency, tasks5, (o) => (o.ok && o.value.http === 200 ? "success" : o.ok ? "error" : isTimeout(o.error) ? "timeout" : "error"));
      const confirmedRows = await prisma.leadPurchase.count({ where: { id: { in: winners.map((w) => w.id) }, status: "CONFIRMED" } });
      const ledgerRows = await prisma.leadFeeLedgerEntry.count({ where: { leadPurchaseId: { in: winners.map((w) => w.id) } } });
      if (confirmedRows !== winners.length) s5.result.invariantViolations.push(`${confirmedRows} confirmed of ${winners.length}`);
      if (ledgerRows !== winners.length) s5.result.invariantViolations.push(`${ledgerRows} ledger entries for ${winners.length} confirmed purchases`);
      const notes = await prisma.notification.groupBy({ by: ["userId", "type", "dedupeKey"], _count: { _all: true }, where: { dedupeKey: { not: null } } });
      if (notes.some((n) => n._count._all !== 1)) s5.result.invariantViolations.push("a business notification exists more than once");

      // ---------------- S6: rollout-guard rejection paths (DISABLED)
      process.env.LEAD_V1_ROLLOUT_MODE = "DISABLED";
      const rowsBefore = { requests: await prisma.serviceRequest.count(), leads: await prisma.lead.count(), purchases: await prisma.leadPurchase.count(), providerCalls: gateway.created.length };
      const tasks6: Array<() => Promise<unknown>> = Array.from({ length: PROFILE.guardRejectionRequests }, (_, i) => {
        const pro = pros[i % pros.length]!;
        switch (i % 3) {
          case 0:
            return () => makeGetLeadFeedForProfessionalUseCase().execute(pro.userId);
          case 1:
            return () => makeInitiateLeadPurchaseUseCase().execute(pro.userId, feedLeads[i % feedLeads.length]!);
          default:
            return () => makeSubmitLeadRequestUseCase(PILOT_PRICING()).execute(customers[i % customers.length]!.userId, REQUEST_INPUT(category.id));
        }
      });
      const s6 = await measure("S6 rollout guard refusals (DISABLED; feed / purchase / submit)", PROFILE.guardConcurrency, tasks6, (o) => (o.ok ? "error" : o.error instanceof LeadV1RolloutDisabledError ? "expected_refusal" : isTimeout(o.error) ? "timeout" : "error"));
      const rowsAfter = { requests: await prisma.serviceRequest.count(), leads: await prisma.lead.count(), purchases: await prisma.leadPurchase.count(), providerCalls: gateway.created.length };
      if (JSON.stringify(rowsBefore) !== JSON.stringify(rowsAfter)) s6.result.invariantViolations.push(`refused calls changed state: ${JSON.stringify(rowsBefore)} -> ${JSON.stringify(rowsAfter)}`);

      // ---------------- report
      const report = {
        module: "M161",
        generatedAt: new Date().toISOString(),
        environment: {
          node: process.version,
          platform: `${process.platform}/${process.arch}`,
          cpus: (await import("node:os")).cpus().length,
          database: "disposable local PostgreSQL (URL not recorded)",
          connectionPoolMaxConfigured: poolMax,
          scope: "in-process calls through real composition roots + webhook route handler; no HTTP server, no network, no real Stripe/e-mail",
        },
        profile: PROFILE,
        scenarios,
        totals: {
          requests: scenarios.reduce((n, s) => n + s.requests, 0),
          unexpectedErrors: scenarios.reduce((n, s) => n + s.unexpectedErrors, 0),
          timeouts: scenarios.reduce((n, s) => n + s.timeouts, 0),
          invariantViolations: scenarios.reduce((n, s) => n + s.invariantViolations.length, 0),
        },
      };
      const out = process.env.M161_LOAD_OUT ?? path.join(process.cwd(), "reports", "m161-load-baseline.json");
      mkdirSync(path.dirname(out), { recursive: true });
      writeFileSync(out, `${JSON.stringify(report, null, 2)}\n`);
      console.info(`[M161 load] ${JSON.stringify(report.totals)} -> ${path.basename(out)}`);
      for (const s of scenarios) {
        console.info(`[M161 load] ${s.name}: n=${s.requests} c=${s.concurrency} ok=${s.success} refused=${s.expectedRefusals} timeouts=${s.timeouts} errors=${s.unexpectedErrors} wall=${s.wallMs}ms rps=${s.throughputPerSec} p50=${s.latencyMs.p50} p95=${s.latencyMs.p95} p99=${s.latencyMs.p99} max=${s.latencyMs.max} peakActive=${s.dbContention?.peakActiveBackends ?? "-"} peakLockWait=${s.dbContention?.peakLockWaiters ?? "-"}`);
      }

      // Only invariants and unexpected failures are asserted. NO latency threshold: none is defined (see the Gate B document).
      expect(report.totals.invariantViolations, JSON.stringify(scenarios.map((s) => s.invariantViolations))).toBe(0);
      expect(report.totals.unexpectedErrors).toBe(0);
      expect(report.totals.timeouts).toBe(0);
    },
    1_800_000,
  );
});

function chunk<T>(items: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
}

/** Deterministic Fisher-Yates (mulberry32): the same profile produces the same interleaving on every run. */
function shuffle<T>(items: T[], seed: number): void {
  let a = seed >>> 0;
  const random = () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  for (let i = items.length - 1; i > 0; i -= 1) {
    const j = Math.floor(random() * (i + 1));
    [items[i], items[j]] = [items[j]!, items[i]!];
  }
}

function isDomainRefusal(error: unknown): boolean {
  const name = error instanceof Error ? error.constructor.name : "";
  return name === "LeadBuyerLimitReachedError" || name === "LeadNotPurchasableError" || name === "DuplicateActiveLeadPurchaseError";
}
