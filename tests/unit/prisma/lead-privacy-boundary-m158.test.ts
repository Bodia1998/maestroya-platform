import { readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

/**
 * Module 158 — source-level boundaries. These pin what the privacy work may and may not touch, so a later change cannot quietly
 * widen it: no legacy money flow, no financial/claim/dispute/audit mutation, no contact data in the new surface, no new audit
 * vocabulary, and the single-reviewed-adapter rule for the contact ports keeps holding.
 */
const root = path.resolve(__dirname, "../../..");
const read = (p: string) => readFileSync(path.join(root, p), "utf8");
const code = (p: string) => read(p).replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");

function walk(dir: string): string[] {
  return readdirSync(dir).flatMap((n) => {
    const full = path.join(dir, n);
    return statSync(full).isDirectory() ? walk(full) : [full];
  });
}
const SRC = walk(path.join(root, "src")).map((f) => path.relative(root, f).split(path.sep).join("/"));

const REPOS = "src/core/infrastructure/database/prisma/repositories";
const RETENTION = `${REPOS}/prisma-lead-privacy-retention-repository.ts`;
const SHARING = `${REPOS}/prisma-lead-contact-sharing-repository.ts`;
const M158_FILES = SRC.filter((f) => /lead-privacy|lead-contact-sharing/.test(f));

describe("M158 — the new surface", () => {
  it("is exactly these files (plus edits to existing GDPR / submit / contact files)", () => {
    expect(M158_FILES.sort()).toEqual(
      [
        "src/app/api/cron/lead-privacy-retention/route.ts",
        "src/core/application/use-cases/lead-privacy/compose.ts",
        "src/core/application/use-cases/lead-privacy/lead-contact-sharing-purchase-gate.ts",
        "src/core/application/use-cases/lead-privacy/record-lead-contact-sharing.use-case.ts",
        "src/core/application/use-cases/lead-privacy/resolve-owned-lead.ts",
        "src/core/application/use-cases/lead-privacy/run-lead-privacy-retention.use-case.ts",
        "src/core/application/use-cases/lead-privacy/withdraw-lead-contact-sharing.use-case.ts",
        "src/core/domain/repositories/lead-privacy-repository.ts",
        "src/core/domain/services/lead-privacy.ts",
        "src/core/infrastructure/config/lead-privacy-config.ts",
        `${REPOS}/prisma-lead-contact-sharing-repository.ts`,
        `${REPOS}/prisma-lead-privacy-retention-repository.ts`,
      ].sort(),
    );
  });

  it("domain and application layers import no Prisma and no database client", () => {
    for (const f of M158_FILES.filter((x) => (x.startsWith("src/core/domain/") || x.startsWith("src/core/application/")) && !x.endsWith("/compose.ts"))) {
      expect(code(f), f).not.toMatch(/@prisma\/client|infrastructure\/database/);
    }
  });

  it("no new surface selects or names a contact column (email, phone, address line, postal code, name)", () => {
    for (const f of [RETENTION, SHARING, ...M158_FILES.filter((x) => x.startsWith("src/core/application/") || x.startsWith("src/core/domain/"))]) {
      expect(code(f), f).not.toMatch(/\b(email|phone|line1|line2|postalCode|passwordHash|latitude|longitude)\b/i);
    }
  });

  it("never touches a legacy quote / payment / commission / payout / invoice / refund / ledger model", () => {
    for (const f of [RETENTION, SHARING, ...M158_FILES.filter((x) => /use-cases\/lead-privacy/.test(x))]) {
      expect(code(f), f).not.toMatch(
        /\b(prisma|tx)\.(quote|payment|commission|payout|invoice|creditNote|refund|financialLedgerEntry|job|dispute)\b|"(quotes|payments|commissions|payouts|invoices|credit_notes|refunds)"/,
      );
    }
  });

  it("never writes a financial, claim, dispute, revocation, abuse, ledger or audit table", () => {
    const src = code(RETENTION) + code(SHARING);
    expect(src).not.toMatch(
      /\.(leadPurchase|leadFee\w*|leadQualityClaim|leadPurchaseRevocation|leadAbuse\w*|auditLog)\.(create|createMany|update|updateMany|upsert|delete|deleteMany)\(/,
    );
    expect(src).not.toMatch(/lead_quality_claims|lead_fee_disputes|lead_purchase_revocations|lead_abuse_|audit_logs/);
    expect(src).not.toMatch(/\$executeRaw|\$executeRawUnsafe|\$queryRawUnsafe/);
  });

  it("the retention repository writes only service_requests text/stamps and takes the lead off through the central propagation helper", () => {
    const src = code(RETENTION);
    expect(src).not.toMatch(/\.lead\.(create|update|updateMany|upsert|delete|deleteMany)\(/);
    expect(src).toContain("propagateServiceRequestStatusToLead(tx");
    expect([...src.matchAll(/\btx\.(\w+)\.(create|createMany|update|updateMany|upsert|delete|deleteMany)\(/g)].map((m) => m[1])).toEqual([
      "serviceRequest",
      "serviceRequest",
      "serviceRequest",
      "serviceRequest",
    ]);
    expect(src).not.toMatch(/requestPhoto/); // photo rows are left for their own purge (documented limitation)
  });

  it("every candidate claim is bounded, scoped to LEAD_V1 and race-safe", () => {
    const src = code(RETENTION);
    expect(src).toContain("FOR UPDATE OF sr SKIP LOCKED");
    expect(src.match(/LIMIT \$\{limit\}/g)).toHaveLength(2);
    expect(src.match(/LEAD_FLOW_VERSION/g)!.length).toBeGreaterThanOrEqual(2);
    expect(src).toContain("MAX_LIMIT");
  });

  it("the sharing table has exactly one writer and the repository never deletes", () => {
    const writers = SRC.filter((f) => /leadContactSharingRecord\.(create|createMany|update|updateMany|upsert|delete|deleteMany)\(/.test(read(f)));
    expect(writers).toEqual([SHARING]);
    expect(code(SHARING)).not.toMatch(/\.(delete|deleteMany|upsert)\(/);
  });

  it("introduces no new audit action: the existing GDPR actions are reused", () => {
    const audit = read("src/core/domain/repositories/admin-audit-log-repository.ts");
    expect(audit).not.toMatch(/LEAD_PRIVACY|LEAD_CONTACT_SHARING|LEAD_CONSENT|RETENTION/);
    const used = new Set<string>();
    for (const f of M158_FILES.filter((x) => /use-cases\/lead-privacy/.test(x))) {
      for (const m of code(f).matchAll(/action: "([A-Z_]+)"/g)) used.add(m[1]!);
    }
    expect([...used].sort()).toEqual(["GDPR_CONSENT_GRANTED", "GDPR_CONSENT_WITHDRAWN", "GDPR_DELETION_EXECUTED"]);
  });

  it("audit metadata is built from ids, enums, versions and counts only — never from request or contact text", () => {
    for (const f of M158_FILES.filter((x) => /use-cases\/lead-privacy/.test(x))) {
      const metadataBlocks = [...code(f).matchAll(/metadata: \{([^}]*)\}/g)].map((m) => m[1]!);
      for (const block of metadataBlocks) expect(block, f).not.toMatch(/title|description|name|address|text|explanation|note/i);
    }
  });

  it("log calls and failure contexts carry no free text or personal values", () => {
    for (const f of M158_FILES) {
      for (const m of code(f).matchAll(/(?:logger\.\w+|report)\([^;]*\);/g)) {
        expect(m[0], `${f}: ${m[0]}`).not.toMatch(/\b(title|description|email|phone|address|name)\b/i);
      }
    }
  });

  it("the M138 contact adapters stay in their single reviewed file and still derive access from the persisted purchase status", () => {
    const readers = SRC.filter((f) => /implements\s+LeadContact(Reader|AuthorizationReader)/.test(read(f)));
    expect(readers).toEqual([`${REPOS}/prisma-lead-contact-access-repository.ts`]);
    const src = code(`${REPOS}/prisma-lead-contact-access-repository.ts`);
    expect(src).toContain('status: "CONFIRMED"');
    expect(src).toContain("decideContactSharing");
    expect(src).toContain("personalDataErasedAt");
    expect(src).not.toMatch(/contactUnlocked/);
  });
});

describe("M158 — migration", () => {
  const dir = readdirSync(path.join(root, "prisma/migrations")).find((d) => d.endsWith("add_module_158_lead_contact_sharing_records"));
  const sql = dir ? read(`prisma/migrations/${dir}/migration.sql`).split("\n").filter((l) => !l.trim().startsWith("--")).join("\n") : "";

  it("exists and is additive (no DROP / DELETE / UPDATE / INSERT / TRUNCATE, no ALTER of an existing table's columns)", () => {
    expect(dir).toBeDefined();
    expect(sql).not.toMatch(/\b(DROP TABLE|DROP COLUMN|DELETE FROM|UPDATE\s+"|INSERT INTO|TRUNCATE|RENAME)\b/i);
    const alterTargets = [...sql.matchAll(/ALTER TABLE\s+(?:"public"\.)?"([^"]+)"/g)].map((m) => m[1]);
    expect(new Set(alterTargets)).toEqual(new Set(["lead_contact_sharing_records"]));
  });

  it("backfills nothing: no row is created for existing leads (no silent consent)", () => {
    expect(sql.replace(/BEFORE INSERT/g, "")).not.toMatch(/\bINSERT\b|\bSELECT\b[^;]*\bFROM\s+"leads"\s*;/i);
  });

  it("uses RESTRICT foreign keys, a withdrawal that is CONSENT-only, and forbids delete", () => {
    expect(sql).toContain('REFERENCES "leads"("id") ON DELETE RESTRICT');
    expect(sql).toContain('REFERENCES "users"("id") ON DELETE RESTRICT');
    expect(sql).toMatch(/"withdrawnAt" IS NULL OR "basis" = 'CONSENT'/);
    expect(sql).toContain("BEFORE DELETE");
    expect(sql).toContain("ENABLE ROW LEVEL SECURITY");
  });

  it("mirrors the Prisma enum and keeps the model scalar-only (no relation touches an existing model)", () => {
    const schema = read("prisma/schema.prisma");
    const enumBody = schema.match(/enum LeadContactSharingBasis \{([^}]*)\}/)![1]!.split("\n").map((l) => l.trim()).filter(Boolean);
    expect(enumBody).toEqual(["CONSENT", "OTHER_LAWFUL_BASIS"]);
    const model = schema.match(/model LeadContactSharingRecord \{([\s\S]*?)\n\}/)![1]!;
    expect(model).not.toMatch(/@relation/);
    expect(model).not.toMatch(/\b(email|phone|name|address|ip|userAgent)\b/i);
  });
});

describe("M158 — legacy flows stay frozen", () => {
  it("none of the M158 files is imported by a legacy quote / payment / commission / payout / settlement module", () => {
    const legacy = SRC.filter((f) => /use-cases\/(quotes|payments|financial|refunds|reconciliation|dispute-resolution|stripe-connect|invoicing)\//.test(f));
    expect(legacy.length).toBeGreaterThan(0);
    for (const f of legacy) expect(read(f), f).not.toMatch(/lead-privacy|lead-contact-sharing/);
  });

  it("the M154–M157 use-case folders were not edited to know about M158", () => {
    for (const f of SRC.filter((x) => /use-cases\/(lead-quality-claim|lead-fee-dispute|lead-abuse|lead-admin-console)\//.test(x))) {
      expect(read(f), f).not.toMatch(/lead-privacy|lead-contact-sharing|decideContactSharing/);
    }
  });
});
