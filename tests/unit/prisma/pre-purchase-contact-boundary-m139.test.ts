import { readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

/**
 * Module 139 — static contract for the PRE-PURCHASE side of the contact
 * boundary: no CONFIRMED LeadPurchase -> no customer contact. These guards
 * fail loudly if a professional-facing path starts loading broad relations,
 * contact columns, or exposes the trusted purchase lifecycle to the browser.
 */
const root = path.resolve(__dirname, "../../..");
const read = (p: string) => readFileSync(path.join(root, p), "utf8");
const stripComments = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1");

function walk(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const full = path.join(dir, name);
    if (statSync(full).isDirectory()) walk(full, out);
    else if (/\.(ts|tsx)$/.test(name)) out.push(full);
  }
  return out;
}

const REPOS = "src/core/infrastructure/database/prisma/repositories";
/** Professional-facing Lead / LeadPurchase read & write adapters (everything except the M138 contact adapter). */
const PRO_FACING_REPOS = [
  `${REPOS}/prisma-lead-feed-repository.ts`,
  `${REPOS}/prisma-lead-preview-repository.ts`,
  `${REPOS}/prisma-lead-purchase-repository.ts`,
  `${REPOS}/prisma-lead-repository.ts`,
];
const CONTACT_COLUMNS = /\b(email|phone|line1|line2|postalCode|passwordHash)\b/;

describe("M139 — professional-facing repositories", () => {
  it.each(PRO_FACING_REPOS)("%s uses explicit select only: no `include`, no whole-relation loading, no contact columns", (file) => {
    const code = stripComments(read(file));
    expect(code).not.toMatch(/\binclude\s*:/);
    expect(code).not.toMatch(/\b(user|address|customer|serviceRequest|purchases)\s*:\s*true\b/);
    expect(code).not.toMatch(CONTACT_COLUMNS);
    // Raw SQL (row locks) may exist, but never against customer / address / user tables.
    for (const raw of code.matchAll(/\$(?:queryRaw|executeRaw)[\s\S]*?`([\s\S]*?)`/g)) {
      expect(raw[1]).not.toMatch(/\b(users|addresses|customer_profiles|"User"|"Address")\b/i);
    }
  });

  it("feed and preview address projections never select street / postal code / address id", () => {
    for (const file of [`${REPOS}/prisma-lead-feed-repository.ts`, `${REPOS}/prisma-lead-preview-repository.ts`]) {
      const code = stripComments(read(file));
      expect(code).toContain("address: { select: { city: true, province: true, latitude: true, longitude: true } }");
      expect(code).toContain("customer: { select: { userId: true } }");
      expect(code).not.toMatch(/purchases|leadPurchase/);
    }
  });

  it("LeadPurchase projection carries no customer or address relation", () => {
    const code = stripComments(read(`${REPOS}/prisma-lead-purchase-repository.ts`));
    const select = code.slice(code.indexOf("const SELECT"), code.indexOf("type Row"));
    expect(select).not.toMatch(/serviceRequest|customer|address|user/i);
  });

  it("the M138 authorization reader selects no contact column (only ids for the ownership comparison)", () => {
    const code = stripComments(read(`${REPOS}/prisma-lead-contact-access-repository.ts`));
    const authSide = code.slice(code.indexOf("class PrismaLeadContactAuthorizationReader"), code.indexOf("class PrismaLeadContactReader"));
    expect(authSide).not.toMatch(CONTACT_COLUMNS);
    expect(authSide).toContain('status: "CONFIRMED"');
    expect(authSide).toContain("professionalProfileId");
  });

  it("no broad `include: { user | address | customer }` anywhere under src/ in a lead-related repository", () => {
    const offenders = walk(path.join(root, REPOS))
      .map((f) => path.relative(root, f))
      .filter((f) => /lead/i.test(path.basename(f)))
      .filter((f) => /\binclude\s*:/.test(stripComments(readFileSync(path.join(root, f), "utf8"))));
    expect(offenders).toEqual([]);
  });
});

describe("M139 — application DTO / use-case layer", () => {
  it.each([
    "src/core/application/dto/lead-feed.dto.ts",
    "src/core/application/dto/lead-purchase.dto.ts",
    "src/core/application/use-cases/lead/get-lead-feed.use-case.ts",
    "src/core/application/use-cases/lead/get-published-lead-previews.use-case.ts",
    "src/core/application/use-cases/lead-purchase/initiate-lead-purchase.use-case.ts",
    "src/core/application/use-cases/lead-purchase/confirm-lead-purchase.use-case.ts",
    "src/core/application/use-cases/lead-purchase/transition-lead-purchase.use-case.ts",
  ])("%s does not touch Prisma, contact ports or the contact DTO", (file) => {
    const code = stripComments(read(file));
    expect(code).not.toMatch(/@prisma\/client|infrastructure\/database\/prisma/);
    expect(code).not.toMatch(/LeadContactReader|LeadContactRecord|toLeadContactDto|LeadContactDTO\b|readContact\(/);
    expect(code).not.toMatch(CONTACT_COLUMNS);
  });

  it("purchase lifecycle DTO has no professional id, customer, address or contact field", () => {
    const iface = read("src/core/application/dto/lead-purchase.dto.ts");
    const body = iface.slice(iface.indexOf("export interface LeadPurchaseDTO"), iface.indexOf("export function toLeadPurchaseDto"));
    expect(body).not.toMatch(/professional|customer|address|contact|email|phone|user/i);
  });

  it("no persisted 'contact unlocked' flag exists and LeadPurchase has no extra status", () => {
    const schema = read("prisma/schema.prisma");
    expect(schema).not.toMatch(/contactUnlocked|contact_unlocked|isUnlocked|contactAccess/i);
    const enumBody = schema.match(/enum LeadPurchaseStatus \{([\s\S]*?)\}/)?.[1] ?? "";
    expect(enumBody.split(/\s+/).filter(Boolean).sort()).toEqual(["CANCELLED", "CONFIRMED", "FAILED", "PENDING_PAYMENT", "REFUNDED", "REVOKED"]);
  });
});

describe("M139 — entry points (Server Actions / routes)", () => {
  const actionsFile = "src/app/(dashboard)/dashboard/professional/leads/actions.ts";

  it("professional lead actions accept no professional / customer / purchase identity", () => {
    const code = stripComments(read(actionsFile));
    const signatures = [...code.matchAll(/export async function (\w+)\(([^)]*)\)/g)].map((m) => ({ name: m[1], params: m[2] }));
    expect(signatures.map((s) => s.name).sort()).toEqual(["getLeadContactAction", "getLeadFeedAction", "getLeadPreviewAction", "getLeadPreviewsAction"]);
    for (const s of signatures) expect(s.params, s.name).not.toMatch(/professional|customer|user|purchase|address/i);
    expect(code.match(/requireAuth\(\)/g)?.length).toBe(signatures.length);
  });

  it("the trusted purchase lifecycle use cases are not reachable from any Server Action / route / page", () => {
    const offenders = walk(path.join(root, "src/app"))
      .map((f) => path.relative(root, f))
      .filter((f) => /lead-purchase\/compose|ConfirmLeadPurchaseUseCase|TransitionLeadPurchaseUseCase|makeConfirmLeadPurchase|makeTransitionLeadPurchase/.test(readFileSync(path.join(root, f), "utf8")));
    expect(offenders).toEqual([]);
  });

  it("M138 stays the only contact entry point: makeGetLeadContactUseCase is used by exactly one action", () => {
    const users = walk(path.join(root, "src"))
      .map((f) => path.relative(root, f))
      .filter((f) => /makeGetLeadContactUseCase|\bGetLeadContactUseCase\b/.test(stripComments(readFileSync(path.join(root, f), "utf8"))));
    expect(users.sort()).toEqual(
      [
        "src/app/(dashboard)/dashboard/professional/leads/actions.ts",
        "src/core/application/use-cases/lead-contact/compose.ts",
        "src/core/application/use-cases/lead-contact/get-lead-contact.use-case.ts",
      ].sort(),
    );
  });
});
