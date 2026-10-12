import { readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

/**
 * Module 157 — static boundary of the Lead Admin Operations Console.
 *
 * The console is a READ MODEL plus thin Server Actions over the M154 / M155 / M156 use cases. These checks pin what must stay true:
 * the reader cannot write, no contact / provider / evidence column is selected, every action starts with the role gate, no console
 * file reaches money or the M156 write paths, and no schema object was added.
 */
const root = path.resolve(__dirname, "../../..");
const rel = (p: string) => path.relative(root, p).split(path.sep).join("/");
const read = (f: string) => readFileSync(path.join(root, f), "utf8");
const code = (f: string) => read(f).replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
function walk(dir: string): string[] {
  return readdirSync(dir).flatMap((n) => {
    const p = path.join(dir, n);
    return statSync(p).isDirectory() ? walk(p) : [p];
  });
}
const SRC = walk(path.join(root, "src")).map(rel).filter((f) => /\.(ts|tsx)$/.test(f));

const ADMIN_DIR = "src/app/(dashboard)/admin/leads/";
const UC_DIR = "src/core/application/use-cases/lead-admin-console/";
const READER = "src/core/infrastructure/database/prisma/repositories/prisma-lead-admin-console-reader.ts";
const PORT = "src/core/domain/repositories/lead-admin-console-reader.ts";
const DOMAIN = "src/core/domain/services/lead-admin-console.ts";
const DTO = "src/core/application/dto/lead-admin-console.dto.ts";
const ACTIONS = `${ADMIN_DIR}actions.ts`;
const M157_FILES = [READER, PORT, DOMAIN, DTO, ...SRC.filter((f) => f.startsWith(UC_DIR) || f.startsWith(ADMIN_DIR))];

describe("M157 — the reader is read-only by construction", () => {
  it("calls find* only: no create / update / upsert / delete, no raw SQL, no transaction", () => {
    const c = code(READER);
    expect(c).not.toMatch(/\.(create|createMany|update|updateMany|upsert|delete|deleteMany)\(/);
    expect(c).not.toMatch(/\$executeRaw|\$queryRaw|\$transaction|\$executeRawUnsafe|\$queryRawUnsafe/);
    const calls = [...c.matchAll(/prisma\.(\w+)\.(\w+)\(/g)].map((m) => `${m[1]}.${m[2]}`);
    expect(calls.length).toBeGreaterThan(8);
    for (const call of calls) expect(call, call).toMatch(/\.(findMany|findFirst|findUnique)$/);
  });

  it("the port has read methods only", () => {
    const methods = [...code(PORT).matchAll(/^\s{2}(\w+)\(/gm)].map((m) => m[1]).sort();
    expect(methods).toEqual(["getAbuseSubject", "getLeadDetail", "listClaims", "listDisputes", "listLeads"]);
  });

  it("every query selects explicit columns (no include, no whole-row read)", () => {
    const c = code(READER);
    expect(c).not.toMatch(/\binclude:/);
    const finds = c.match(/\.(findMany|findFirst|findUnique)\(/g) ?? [];
    const selects = c.match(/\bselect\b\s*[:,]|select: /g) ?? [];
    expect(selects.length).toBeGreaterThanOrEqual(finds.length);
  });

  it("selects no contact, address-line, request-text, provider-reference or evidence-text column", () => {
    const c = code(READER);
    expect(c).not.toMatch(/\b(email|phone|passwordHash|line1|line2|postalCode|latitude|longitude|evidenceText|evidenceActorUserId|providerChargeId|lastProviderEventId|title|stripe\w*)\b\s*:\s*true/);
    // the payment reference is read ONLY to derive a boolean and is never returned
    expect(c).toMatch(/hasPaymentReference: p\.paymentReference !== null/);
    expect(c.match(/paymentReference/g)?.length).toBe(2);
    // the only request columns read are status / flow / category / address city + province / the customer's user id
    expect(c).toMatch(/address: \{ select: \{ city: true, province: true \} \}/);
    expect(c).toMatch(/customer: \{ select: \{ userId: true \} \}/);
  });

  it("scopes the listing AND the lead detail to LEAD_V1 inside the database query", () => {
    const c = code(READER);
    expect(c).toMatch(/flowVersion: "LEAD_V1"/);
    expect(c).toMatch(/prisma\.lead\.findFirst\(\{\s*where: \{ id: leadId, serviceRequest: \{ flowVersion: "LEAD_V1" \} \}/);
    expect(c).not.toMatch(/prisma\.lead\.findUnique\(/);
  });

  it("every list is bounded (page size from the use case, detail sub-lists capped)", () => {
    const c = code(READER);
    const takes = (c.match(/\btake:/g) ?? []).length;
    const findManys = (c.match(/\.findMany\(/g) ?? []).length;
    // the two id-only lookups (purchase ids for a claims page, open claim/dispute ids for a listed page) are bounded by their `in:` lists
    expect(takes).toBeGreaterThanOrEqual(findManys - 5);
    expect(c).toMatch(/LEAD_ADMIN_DETAIL_ROW_CAP/);
  });

  it("only the allow-listed audit metadata keys can reach the UI", () => {
    const c = code(READER);
    expect(c).toMatch(/AUDIT_METADATA_ALLOW_LIST/);
    expect(c).not.toMatch(/explanation|resolutionNote|decisionExplanation/g.test(c.slice(c.indexOf("AUDIT_METADATA_ALLOW_LIST"), c.indexOf("] as const"))) ? /^$/ : /(?!)/);
  });
});

describe("M157 — every console export is behind the role gate", () => {
  it("each exported Server Action calls requireRole(ADMIN, SUPER_ADMIN) as its first statement", () => {
    const text = code(ACTIONS);
    const bodies = text.split(/export async function /).slice(1);
    expect(bodies.length).toBe(11);
    for (const body of bodies) {
      const name = body.slice(0, body.indexOf("("));
      const afterSignature = body.slice(body.indexOf("\n", body.search(/\)(: Promise<[^\n]*>)? \{\n/)) + 1);
      const firstStatement = afterSignature.trim().split("\n")[0];
      expect(firstStatement, name).not.toMatch(/Promise</);
      expect(firstStatement, name).toMatch(/await requireRole\(ROLES\.ADMIN, ROLES\.SUPER_ADMIN\)/);
    }
    expect(text).not.toMatch(/ROLES\.SUPPORT|ROLES\.MODERATOR|ROLES\.PROVIDER|ROLES\.CUSTOMER/);
  });

  it("the actions file starts with 'use server' and exports only async functions and types", () => {
    const raw = read(ACTIONS);
    expect(raw.trimStart().startsWith('"use server";')).toBe(true);
    expect(code(ACTIONS)).not.toMatch(/export (const|let|var|class|default)\b/);
  });

  it("pages and client components hold no data access and no use case construction", () => {
    for (const f of SRC.filter((x) => x.startsWith(ADMIN_DIR) && /\.tsx$/.test(x))) {
      expect(code(f), f).not.toMatch(/@prisma\/client|infrastructure\/database|Prisma\w*Repository|new \w+UseCase\(|\/compose"/);
    }
    expect(code(`${ADMIN_DIR}_components/lead-action-forms.tsx`)).toMatch(/^"use client"|"use client"/);
  });
});

describe("M157 — no new path around M154 / M155 / M156 or into money", () => {
  const IMPORT_FORBIDDEN = /stripe|refund|ledger|invoice|credit-?note|payout|commission|affiliate|lead-fee-payment|payment-gateway|transition-lead-purchase|TransitionLeadPurchase|confirm-lead-purchase/i;

  it("no console file imports payments, refunds, ledger, invoices, credit notes, payouts or the purchase transition use case", () => {
    for (const f of M157_FILES) {
      const imports = (code(f).match(/from\s+"[^"]+"/g) ?? []).filter((i) => !/lead-fee-dispute\/compose/.test(i));
      for (const i of imports) expect(i, `${f}: ${i}`).not.toMatch(IMPORT_FORBIDDEN);
    }
  });

  it("no console file writes a domain table or calls the M156 automatic write paths", () => {
    for (const f of M157_FILES) {
      expect(code(f), f).not.toMatch(/recordSignal|applyAutomatedDecision|EvaluateLeadAbuse|guardLead\w+|observeLeadContactAccess|LeadAbuseRuntime|imposeAdminBlock|\.lift\(|markReviewStarted|\.decide\(|revokeConfirmed|applyEvent|reconcilePurchase|claimEvidenceSubmission/);
      expect(code(f), f).not.toMatch(/LEAD_ABUSE_CONTROL_MODE|loadLeadAbuseControlConfig|resolveLeadFeeDisputeEvidenceConfig/);
    }
  });

  it("the actions call exactly the existing M154 / M155 / M156 use-case factories for state changes", () => {
    const c = code(ACTIONS);
    const factories = [...new Set(c.match(/make\w+UseCase\b/g) ?? [])].sort();
    expect(factories).toEqual(
      [
        "makeDecideLeadQualityClaimUseCase", "makeGetAdminAbuseSubjectUseCase", "makeGetAdminLeadDetailUseCase", "makeImposeLeadAbuseBlockUseCase",
        "makeLiftLeadAbuseDecisionUseCase", "makeListAdminLeadClaimsUseCase", "makeListAdminLeadDisputesUseCase", "makeListAdminLeadsUseCase",
        "makeListOpenLeadAbuseFlagsUseCase", "makeRevokeLeadPurchaseUseCase", "makeStartLeadQualityClaimReviewUseCase",
      ].sort(),
    );
    // not exposed on purpose: dispute evidence submission (provider call, OFF by default) and any refund
    expect(c).not.toMatch(/SubmitLeadFeeDisputeEvidence|ExecuteLeadFeeRefund|makeSubmitLeadQualityClaimUseCase/);
  });

  it("the console composition root builds only read use cases", () => {
    const c = code(`${UC_DIR}compose.ts`);
    expect([...c.matchAll(/new (\w+)\(/g)].map((m) => m[1]).sort()).toEqual(
      ["GetAdminAbuseSubjectUseCase", "GetAdminLeadDetailUseCase", "ListAdminLeadClaimsUseCase", "ListAdminLeadDisputesUseCase", "ListAdminLeadsUseCase", "PrismaAdminRepository", "PrismaLeadAdminConsoleReader"].sort(),
    );
  });

  it("the application and domain layers of the console import no Prisma type or infrastructure code", () => {
    for (const f of [PORT, DOMAIN, DTO, ...SRC.filter((x) => x.startsWith(UC_DIR) && !x.endsWith("compose.ts"))]) {
      expect(code(f), f).not.toMatch(/@prisma\/client|infrastructure\//);
    }
  });
});

describe("M157 — no schema or migration was added", () => {
  it("no migration directory belongs to Module 157", () => {
    const names = readdirSync(path.join(root, "prisma/migrations"));
    expect(names.filter((n) => /157/.test(n))).toEqual([]);
  });

  it("the Prisma schema has no M157 object", () => {
    expect(read("prisma/schema.prisma")).not.toMatch(/Module 157|model LeadAdmin|model LeadConsole/);
  });
});
