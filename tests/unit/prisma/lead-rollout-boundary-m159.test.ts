import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

/**
 * Module 159 — static contract of the LEAD_V1 rollout controls:
 *  (1) every use case that STARTS new LEAD_V1 activity is constructed only inside a composition root, and that root wraps it with
 *      the rollout guard — so no Server Action / route can reach a raw one;
 *  (2) nothing that finishes or protects existing business (webhooks, contact access, refunds, credit notes, invoices, claims,
 *      disputes, revocation, reconciliation, admin mutations, consent withdrawal, retention) imports the rollout controls;
 *  (3) the controls are isolated from the legacy quote/payment/commission/payout/settlement code, from the Module 52 flag service
 *      and from the other lead switches (pricing, privacy, abuse) — one responsibility each;
 *  (4) the controls hold no state, touch no database and add no migration.
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
const UC = "src/core/application/use-cases/";

const M159_FILES = [
  "src/core/domain/services/lead-rollout.ts",
  "src/core/infrastructure/config/lead-rollout-config.ts",
  `${UC}lead-rollout/lead-rollout-guard.ts`,
  `${UC}lead-rollout/compose.ts`,
];

/** use case class -> the ONLY file allowed to construct it, and the guard that file must apply. */
const GATED: Array<{ useCase: string; compose: string; guard: "guardLeadV1Entry" | "guardLeadV1Purchase"; factory: string }> = [
  { useCase: "SubmitLeadRequestUseCase", compose: `${UC}lead-request/compose.ts`, guard: "guardLeadV1Entry", factory: "makeSubmitLeadRequestUseCase" },
  { useCase: "CreateLeadV1ServiceRequestUseCase", compose: `${UC}lead/compose.ts`, guard: "guardLeadV1Entry", factory: "makeCreateLeadV1ServiceRequestUseCase" },
  { useCase: "CreateLeadUseCase", compose: `${UC}lead/compose.ts`, guard: "guardLeadV1Entry", factory: "makeCreateLeadUseCase" },
  { useCase: "PublishLeadUseCase", compose: `${UC}lead-publication/compose.ts`, guard: "guardLeadV1Entry", factory: "makePublishLeadUseCase" },
  { useCase: "GetLeadFeedForProfessionalUseCase", compose: `${UC}lead/compose.ts`, guard: "guardLeadV1Purchase", factory: "makeGetLeadFeedForProfessionalUseCase" },
  { useCase: "GetPublishedLeadPreviewsForProfessionalUseCase", compose: `${UC}lead/compose.ts`, guard: "guardLeadV1Purchase", factory: "makeGetPublishedLeadPreviewsForProfessionalUseCase" },
  { useCase: "InitiateLeadPurchaseUseCase", compose: `${UC}lead-purchase/compose.ts`, guard: "guardLeadV1Purchase", factory: "makeInitiateLeadPurchaseUseCase" },
  { useCase: "InitiateLeadFeePaymentUseCase", compose: `${UC}lead-fee-payment/compose.ts`, guard: "guardLeadV1Purchase", factory: "makeInitiateLeadFeePaymentUseCase" },
];

/** Strips the body of exported factory `name` out of a compose file. */
function factoryBody(file: string, name: string): string {
  const src = code(file);
  const start = src.indexOf(`export function ${name}(`);
  expect(start, `${name} in ${file}`).toBeGreaterThanOrEqual(0);
  const next = src.indexOf("\nexport ", start + 10);
  return src.slice(start, next === -1 ? undefined : next);
}

describe("M159 — guarded use cases are constructed only in composition roots, wrapped by the right guard", () => {
  it.each(GATED)("$useCase is built in exactly one production file ($compose), inside $factory, under $guard", ({ useCase, compose, guard, factory }) => {
    const constructors = SRC.filter((f) => new RegExp(`new ${useCase}\\(`).test(code(f)));
    expect(constructors).toEqual([compose]);
    const body = factoryBody(compose, factory);
    // the VALUE the factory returns is the guarded one (no unguarded return path)
    const returns = body.match(/\breturn\b/g) ?? [];
    expect(returns).toHaveLength(1);
    expect(body).toMatch(new RegExp(`return\\s+${guard}\\(`));
    expect(body).toContain(`new ${useCase}(`);
  });

  it("src/app (Server Actions, pages, routes) never constructs a gated use case and never imports a repository", () => {
    for (const file of SRC.filter((f) => f.startsWith("src/app/"))) {
      for (const { useCase } of GATED) expect(code(file), `${file} builds ${useCase}`).not.toMatch(new RegExp(`new ${useCase}\\(`));
    }
  });

  it("the publication / purchase factories apply the rollout guard OUTSIDE the M156 abuse guard", () => {
    const publish = factoryBody(`${UC}lead-publication/compose.ts`, "makePublishLeadUseCase");
    expect(publish.indexOf("guardLeadV1Entry(")).toBeLessThan(publish.indexOf("guardLeadPublication("));
    const purchase = factoryBody(`${UC}lead-purchase/compose.ts`, "makeInitiateLeadPurchaseUseCase");
    expect(purchase.indexOf("guardLeadV1Purchase(")).toBeLessThan(purchase.indexOf("guardLeadPurchaseInitiation("));
  });
});

describe("M159 — the switch never touches existing rights, payments in flight or financial records", () => {
  const IMPORTERS = SRC.filter((f) => !M159_FILES.includes(f) && /lead-rollout/.test(code(f)));

  it("only the guarded composition roots (plus the one admin status read) import the rollout controls", () => {
    const allowed = new Set([...GATED.map((g) => g.compose), "src/app/(dashboard)/admin/leads/_lib/rollout-status.ts"]);
    expect(IMPORTERS.filter((f) => !allowed.has(f))).toEqual([]);
  });

  it.each([
    "src/app/api/webhooks/stripe-payments/route.ts",
    "src/app/api/cron/lead-privacy-retention/route.ts",
    "src/app/api/cron/reconciliation-run/route.ts",
    `${UC}lead-fee-payment/process-lead-fee-payment-webhook.use-case.ts`,
    `${UC}lead-fee-dispute/compose.ts`,
    `${UC}lead-fee-refund/compose.ts`,
    `${UC}lead-fee-credit-note/compose.ts`,
    `${UC}lead-fee-invoice/compose.ts`,
    `${UC}lead-fee-document-reconciliation/compose.ts`,
    `${UC}lead-quality-claim/compose.ts`,
    `${UC}lead-contact/compose.ts`,
    `${UC}lead-checkout/compose.ts`,
    `${UC}lead-privacy/compose.ts`,
    `${UC}lead-admin-console/compose.ts`,
    `${UC}lead-abuse/compose.ts`,
  ])("%s does not import the rollout controls", (file) => {
    expect(code(file)).not.toMatch(/lead-rollout|guardLeadV1|LeadV1RolloutDisabledError/);
  });

  it("the webhook route keeps its fail-safe structure: lead-fee events are handled before any gate could exist", () => {
    const route = code("src/app/api/webhooks/stripe-payments/route.ts");
    expect(route).toContain("makeProcessLeadFeePaymentWebhookUseCase");
    expect(route).toContain("makeProcessLeadFeeDisputeWebhookUseCase");
  });

  it("the admin Server Actions (refund / revoke / claim decisions / abuse blocks) call no rollout control and gain no export", () => {
    const actions = code("src/app/(dashboard)/admin/leads/actions.ts");
    expect(actions).not.toMatch(/lead-rollout|guardLeadV1|getLeadRolloutStatus|LeadV1RolloutDisabledError|assertLeadRolloutAreaOpen/);
  });

  it("the admin status read is admin-gated first, read-only, and not a Server Action", () => {
    const helper = read("src/app/(dashboard)/admin/leads/_lib/rollout-status.ts");
    expect(helper.trimStart().startsWith('"use server"')).toBe(false);
    const body = code("src/app/(dashboard)/admin/leads/_lib/rollout-status.ts");
    expect(body.indexOf("requireRole(ROLES.ADMIN, ROLES.SUPER_ADMIN)")).toBeGreaterThan(-1);
    expect(body.indexOf("requireRole(")).toBeLessThan(body.indexOf("getLeadRolloutStatus()"));
    expect(body).not.toMatch(/process\.env|prisma|\.(create|update|delete|upsert)\(/);
  });
});

describe("M159 — one responsibility: isolated from legacy flows, flags, pricing, privacy and abuse controls", () => {
  const SOURCES = M159_FILES.map((f) => ({ f, c: code(f) }));

  it("imports nothing from legacy quote / payment / commission / payout / settlement / invoice / affiliate code", () => {
    for (const { f, c } of SOURCES) {
      expect(c, f).not.toMatch(/use-cases\/(quotes|payments|financial|payouts?|invoicing|affiliate|stripe-connect|settlement)/);
      expect(c, f).not.toMatch(/customer-payment-capture|transaction-flow|TransactionFlowGuard|LegacyFlowBoundaryError/);
    }
  });

  it("does not use the Module 52 flag service, so FEATURE_FLAGS_* (and the legacy payment kill switch) are unaffected and vice versa", () => {
    for (const { f, c } of SOURCES) {
      expect(c, f).not.toMatch(/feature-flags|FEATURE_FLAGS|isFeatureEnabled|evaluateFlag/);
    }
  });

  it("does not read pricing, privacy, abuse or Stripe configuration (those controls keep their own meaning)", () => {
    for (const { f, c } of SOURCES) {
      expect(c, f).not.toMatch(/LEAD_PRICING|LEAD_CONTACT_SHARING|LEAD_ABUSE|LEAD_PRIVACY|STRIPE_/);
      expect(c, f).not.toMatch(/lead-pricing|lead-privacy|lead-abuse/);
    }
  });

  it("is stateless and database-free: no Prisma, no module-level mutable state, no timers, no randomness", () => {
    for (const { f, c } of SOURCES) {
      expect(c, f).not.toMatch(/prisma|@prisma|Math\.random|setTimeout|setInterval|new Map\(|new Set\(|\blet\s/);
    }
  });

  it("the only environment read is the single LEAD_V1_ROLLOUT_MODE variable, in the infrastructure loader", () => {
    const readers = M159_FILES.filter((f) => /process\.env|env\./.test(code(f)));
    expect(readers).toEqual(["src/core/infrastructure/config/lead-rollout-config.ts"]);
    expect(code("src/core/infrastructure/config/lead-rollout-config.ts").match(/process\.env/g)).toHaveLength(1);
  });

  it("adds no migration and no schema change", () => {
    const migrations = walk(path.join(root, "prisma/migrations")).map(rel);
    expect(migrations.filter((m) => /159|rollout/i.test(m))).toEqual([]);
    expect(read("prisma/schema.prisma")).not.toMatch(/rollout/i);
  });

  it("the legacy flow guard (M121/M131) does not depend on the rollout switch: LEAD_V1 isolation holds in EVERY mode", () => {
    for (const f of SRC.filter((s) => /transaction-flow-guard|legacy-flow|prisma-legacy-flow/.test(s))) {
      expect(code(f), f).not.toMatch(/lead-rollout|LEAD_V1_ROLLOUT_MODE/);
    }
  });

  it("the default of the switch is documented as DISABLED in .env.example and no environment file enables it", () => {
    expect(/LEAD_V1_ROLLOUT_MODE/.test(read(".env.example"))).toBe(true);
    for (const file of [".env.example", ".env.test"]) {
      const active = read(file).split("\n").filter((l) => /^\s*LEAD_V1_ROLLOUT_MODE\s*=/.test(l));
      for (const line of active) expect(line.replace(/["'\s]/g, ""), `${file}: ${line}`).toMatch(/^LEAD_V1_ROLLOUT_MODE=(DISABLED)?$/);
    }
    // Boolean-only assertions: an environment file's content must never end up in a failure message.
    for (const file of [".env.production", "docker-compose.prod.yml", "vercel.json"]) {
      const enablesIt = existsSync(path.join(root, file)) && /LEAD_V1_ROLLOUT_MODE\s*[=:]\s*["']?(ENABLED|ENTRY_ONLY|PURCHASE_ONLY)/.test(read(file));
      expect(enablesIt, `${file} must not enable LEAD_V1`).toBe(false);
    }
  });
});
