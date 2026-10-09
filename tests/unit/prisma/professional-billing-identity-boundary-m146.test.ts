import { readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

/**
 * Module 146 — static contract for the professional billing identity.
 *
 * Pins: (1) the identity is referenced ONLY by its own files — so it cannot leak into the
 * M134 feed, M124 preview, M138 contact unlock, M145 notifications or the M140/M141 payment and
 * M126/M135 purchase paths, and no purchase/payment gate was introduced (M147's job);
 * (2) verification authority: only the admin use cases / admin actions can verify; (3) layering;
 * (4) an additive, backfill-free migration.
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

/** The complete, closed set of source files that may mention the billing identity. */
const OWNERS = new Set([
  "src/core/domain/services/professional-billing-identity.ts",
  "src/core/domain/repositories/professional-billing-identity-repository.ts",
  "src/core/infrastructure/database/prisma/repositories/prisma-professional-billing-identity-repository.ts",
  "src/core/application/dto/professional-billing-identity.dto.ts",
  "src/core/application/use-cases/billing-identity/compose.ts",
  "src/core/application/use-cases/billing-identity/get-my-billing-identity.use-case.ts",
  "src/core/application/use-cases/billing-identity/save-my-billing-identity.use-case.ts",
  "src/core/application/use-cases/billing-identity/review-billing-identity.use-cases.ts",
  "src/core/application/use-cases/billing-identity/get-professional-billing-readiness.use-case.ts",
  "src/app/(dashboard)/dashboard/professional/billing/actions.ts",
  "src/app/(dashboard)/dashboard/professional/billing/billing-identity-form.tsx",
  "src/app/(dashboard)/dashboard/professional/billing/page.tsx",
  "src/app/(dashboard)/admin/billing-identities/actions.ts",
  // audit action names only (see below)
  "src/core/domain/repositories/admin-audit-log-repository.ts",
  "src/core/infrastructure/database/prisma/repositories/prisma-admin-audit-log-repository.ts",
]);
const MENTIONS = /billing-identity|BillingIdentity|billingIdentity|BILLING_IDENTITY|professional_billing_identit/;

describe("M146 isolation — billing data stays out of every other flow", () => {
  it("only the M146 files (and the audit action list) mention the billing identity", () => {
    const offenders = SRC.filter((f) => !OWNERS.has(f) && MENTIONS.test(read(f)));
    expect(offenders).toEqual([]);
  });

  it("the audit files only gained action names, nothing that carries billing data", () => {
    for (const f of ["src/core/domain/repositories/admin-audit-log-repository.ts", "src/core/infrastructure/database/prisma/repositories/prisma-admin-audit-log-repository.ts"]) {
      const lines = code(f).split("\n").filter((l) => MENTIONS.test(l));
      expect(lines.length).toBeGreaterThan(0);
      for (const l of lines) expect(l).toMatch(/^\s*\|?\s*"?BILLING_IDENTITY_(SUBMITTED|VERIFIED|REJECTED)"?\s*[:|]?\s*("VERIFICATION",)?\s*$/);
    }
  });

  const SENSITIVE = /taxId|taxCountry|legalName|billing(Address|Identity|Details)/i;

  it.each([
    "src/core/application/dto/lead-feed.dto.ts",
    "src/core/application/dto/lead-contact.dto.ts",
    "src/core/application/dto/lead-purchase.dto.ts",
    "src/core/application/dto/lead-purchase-checkout.dto.ts",
    "src/core/application/dto/lead-fee-payment.dto.ts",
    "src/core/application/dto/notification.dto.ts",
    "src/core/domain/services/lead-notification.ts",
    "src/core/domain/repositories/lead-feed-repository.ts",
    "src/core/domain/repositories/lead-preview-repository.ts",
    "src/core/domain/repositories/lead-notification-context-reader.ts",
  ])("%s (feed / preview / contact / purchase / payment / notification DTOs) carries no billing field", (f) => {
    expect(code(f)).not.toMatch(SENSITIVE);
  });

  it("no lead / purchase / payment / notification / contact Prisma adapter reads the billing table", () => {
    const adapters = SRC.filter((f) => /prisma-lead-|stripe-lead-fee|prisma-notification/.test(f));
    expect(adapters.length).toBeGreaterThan(3);
    for (const f of adapters) expect(code(f), f).not.toMatch(/professionalBillingIdentity|billingIdentity/);
  });

  it("M145 notification templates (all locales) have no billing placeholder or tax-id wording", () => {
    const dir = path.join(root, "src/i18n/messages");
    for (const locale of readdirSync(dir)) {
      const json = JSON.parse(read(`src/i18n/messages/${locale}/notificationTemplates.json`));
      const lead = JSON.stringify(Object.fromEntries(Object.entries(json).filter(([k]) => /lead/i.test(k))));
      expect(lead, locale).not.toMatch(/\{[^}]*(taxId|legalName|billing|address)[^}]*\}/i);
    }
  });

  it("introduces NO purchase / payment gate: the purchase and payment use cases and eligibility predicate know nothing about it", () => {
    for (const f of [
      "src/core/application/use-cases/lead-purchase/initiate-lead-purchase.use-case.ts",
      "src/core/application/use-cases/lead-purchase/confirm-lead-purchase.use-case.ts",
      "src/core/application/use-cases/lead-fee-payment/initiate-lead-fee-payment.use-case.ts",
      "src/core/application/use-cases/lead-fee-payment/process-lead-fee-payment-webhook.use-case.ts",
      "src/core/application/use-cases/lead-contact/get-lead-contact.use-case.ts",
      "src/core/domain/services/lead-purchase.ts",
      "src/core/domain/services/lead-fee-payment-confirmation.ts",
      "src/core/domain/services/lead-fee-tax-policy.ts",
    ]) {
      expect(code(f), f).not.toMatch(MENTIONS);
    }
  });

  it("does not recalculate or alter tax: the policy file is untouched in intent (21% pilot, v1)", () => {
    const tax = code("src/core/domain/services/lead-fee-tax-policy.ts");
    expect(tax).toMatch(/LEAD_FEE_IVA_RATE_BPS = 2100n/);
    expect(code("src/core/domain/services/professional-billing-identity.ts")).not.toMatch(/2100|rateBps|computeLeadFeeTax|IVA\s*=|taxRate/i);
  });

  it("does not read or write the legacy self-billing / invoice / quote / payout aggregates", () => {
    for (const f of [...OWNERS].filter((o) => o.includes("billing-identity") || o.includes("billing/"))) {
      expect(code(f), f).not.toMatch(/SelfBilling|selfBilling|invoice|Invoice|CreditNote|Quote|payoutAccount|PayoutAccount|stripe/i);
    }
  });
});

describe("M146 verification authority", () => {
  it("the professional action file cannot verify: no role gate import, no verify/reject use case", () => {
    const f = code("src/app/(dashboard)/dashboard/professional/billing/actions.ts");
    expect(f).not.toMatch(/makeVerifyBillingIdentityUseCase|makeRejectBillingIdentityUseCase|requireRole/);
    expect(f).toMatch(/requireAuth\(\)/);
  });

  it("the form is a Client Component with no status / verification input", () => {
    const f = code("src/app/(dashboard)/dashboard/professional/billing/billing-identity-form.tsx");
    expect(f).toMatch(/^"use client"/);
    expect(f).not.toMatch(/verificationStatus|reviewedBy|reviewNote|revision|"VERIFIED"|professionalProfileId/);
  });

  it("every admin action starts by requiring ADMIN/SUPER_ADMIN", () => {
    const f = code("src/app/(dashboard)/admin/billing-identities/actions.ts");
    const bodies = f.split(/export async function /).slice(1);
    expect(bodies).toHaveLength(2);
    for (const body of bodies) {
      const firstStatement = body.slice(body.indexOf("{") + 1).trimStart();
      expect(firstStatement.startsWith("const admin = await requireRole(ROLES.ADMIN, ROLES.SUPER_ADMIN);")).toBe(true);
    }
  });

  it("the repository write used by the professional flow has no status parameter", () => {
    const port = code("src/core/domain/repositories/professional-billing-identity-repository.ts");
    const save = port.match(/saveDetails\(([^)]*)\)/)?.[1] ?? "";
    expect(save).toMatch(/professionalProfileId: string, details: BillingIdentityDetails/);
    expect(save).not.toMatch(/status|verified/i);
  });

  it("the Prisma adapter's create/update paths never write VERIFIED outside markVerified", () => {
    const src = code("src/core/infrastructure/database/prisma/repositories/prisma-professional-billing-identity-repository.ts");
    expect(src.match(/"VERIFIED"/g)?.length).toBe(2); // markVerified (data) and markRejected (revocable-from list)
    const saveBody = src.slice(src.indexOf("async saveDetails"), src.indexOf("async markVerified"));
    expect(saveBody).not.toMatch(/"VERIFIED"|"REJECTED"/);
  });
});

describe("M146 layering", () => {
  const PURE = [
    "src/core/domain/services/professional-billing-identity.ts",
    "src/core/domain/repositories/professional-billing-identity-repository.ts",
    "src/core/application/dto/professional-billing-identity.dto.ts",
    "src/core/application/use-cases/billing-identity/get-my-billing-identity.use-case.ts",
    "src/core/application/use-cases/billing-identity/save-my-billing-identity.use-case.ts",
    "src/core/application/use-cases/billing-identity/review-billing-identity.use-cases.ts",
    "src/core/application/use-cases/billing-identity/get-professional-billing-readiness.use-case.ts",
  ];
  it.each(PURE)("%s imports no Prisma, Next or infrastructure", (f) => {
    expect(code(f)).not.toMatch(/@prisma\/client|from "next|next\/|server-only|@\/infrastructure|@\/presentation|stripe/i);
  });

  it("no raw tax id / address is passed to a logger", () => {
    for (const f of [...OWNERS].filter((o) => o.includes("billing"))) {
      expect(code(f), f).not.toMatch(/console\.(log|info|warn|error)\([^)]*(taxId|legalName|address|details)/i);
    }
  });
});

describe("M146 schema and migration", () => {
  const MIGRATION = "prisma/migrations/20261012000000_add_module_146_professional_billing_identity/migration.sql";
  const sql = () => read(MIGRATION).replace(/--.*$/gm, "");

  it("sits after M145's migration; only later modules' migrations may follow it (old migrations are not modified, only added to)", () => {
    const names = readdirSync(path.join(root, "prisma/migrations")).filter((n) => /^\d{14}_/.test(n)).sort();
    const index = names.indexOf("20261012000000_add_module_146_professional_billing_identity");
    expect(index).toBeGreaterThan(names.indexOf("20261011000000_add_module_145_lead_notifications"));
    for (const later of names.slice(index + 1)) expect(later).toMatch(/_add_module_(14[7-9]|1[5-9]\d)_/);
  });

  it("is additive: creates objects only, with no destructive or data-changing statement", () => {
    const text = sql();
    expect(text).not.toMatch(/\bDROP\s+(TABLE|COLUMN|TYPE|INDEX|CONSTRAINT)\b/i);
    expect(text).not.toMatch(/\bTRUNCATE\b/i);
    expect(text).not.toMatch(/^\s*(INSERT\s+INTO|DELETE\s+FROM|UPDATE\s+["\w])/im);
    for (const m of text.matchAll(/ALTER TABLE\s+"?(\w+)"?/gi)) expect(m[1]).toBe("professional_billing_identities");
  });

  it("backfills nothing and creates no VERIFIED data", () => {
    const text = sql();
    expect(text).not.toMatch(/INSERT\s+INTO/i);
    expect(text).not.toMatch(/DEFAULT\s+'VERIFIED'/i);
    expect(text).not.toMatch(/professional_profiles"\s*\./i);
  });

  it("declares the integrity constraints and both guard triggers", () => {
    const text = sql();
    for (const name of [
      "professional_billing_identities_status_allowed",
      "professional_billing_identities_verified_metadata",
      "professional_billing_identities_rejection_reason",
      "professional_billing_identities_shape",
      "professional_billing_identity_insert_guard",
      "professional_billing_identity_guard",
    ]) expect(text, name).toContain(name);
    expect(text).toMatch(/BEFORE INSERT ON/);
    expect(text).toMatch(/BEFORE UPDATE ON/);
  });

  it("schema: one row per profile, cascade with the profile, tax id deliberately not unique", () => {
    const schema = read("prisma/schema.prisma");
    const model = schema.slice(schema.indexOf("model ProfessionalBillingIdentity"), schema.indexOf('@@map("professional_billing_identities")'));
    expect(model).toMatch(/professionalProfileId\s+String\s+@unique/);
    expect(model).toMatch(/onDelete: Cascade/);
    expect(model).not.toMatch(/taxId\s+String[^\n]*@unique/);
    expect(model).not.toMatch(/@@unique/);
    expect(model).toMatch(/verificationStatus\s+VerificationStatus\s+@default\(UNVERIFIED\)/);
  });
});
