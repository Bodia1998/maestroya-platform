import { readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

/**
 * Module 122 — static contract: the repository-level facts the contact
 * boundary relies on. Cheap guards against silent regressions.
 */
const root = path.resolve(__dirname, "../../..");
const read = (p: string) => readFileSync(path.join(root, p), "utf8");

function walk(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const full = path.join(dir, name);
    if (statSync(full).isDirectory()) walk(full, out);
    else if (/\.(ts|tsx)$/.test(name)) out.push(full);
  }
  return out;
}

describe("contact protection boundary — static contract", () => {
  const discovery = read("src/core/infrastructure/database/prisma/repositories/prisma-service-request-discovery-repository.ts");

  it("legacy professional feed excludes LEAD_V1 at query level", () => {
    expect(discovery.match(/flowVersion: LEGACY_FLOW/g)?.length).toBe(2);
  });

  it("legacy professional feed never selects customer contact columns", () => {
    const select = discovery.slice(discovery.indexOf("const CANDIDATE_SELECT"), discovery.indexOf("type CandidateRow"));
    expect(select).not.toMatch(/email|phone|line1|line2|postalCode/);
    expect(select).toContain("customer: { select: { userId: true } }");
    expect(select).toContain("address: { select: { city: true, province: true, latitude: true, longitude: true } }");
  });

  it("LeadContactReader is only consumed by GetLeadContactUseCase (and its port/Prisma adapter/composition)", () => {
    const allowed = new Set([
      "src/core/application/ports/lead-contact-access.ts",
      "src/core/application/use-cases/lead-contact/get-lead-contact.use-case.ts",
      // Module 138: the Prisma adapter implements the port; it is only handed to the use case below.
      "src/core/infrastructure/database/prisma/repositories/prisma-lead-contact-access-repository.ts",
      // Module 138: composition root only hands the adapter to the use case; it never calls readContact.
      "src/core/application/use-cases/lead-contact/compose.ts",
    ]);
    const offenders = walk(path.join(root, "src"))
      .map((f) => path.relative(root, f))
      .filter((f) => !allowed.has(f))
      .filter((f) => /LeadContactReader|readContact\(/.test(readFileSync(path.join(root, f), "utf8")));
    expect(offenders).toEqual([]);
  });

  it("Lead / LeadPurchase tables (Module 123) hold no customer contact columns", () => {
    // Module 122 asserted these models did not exist yet. Module 123 introduces
    // them, so the invariant that still matters is that they never carry
    // contact data (contact stays reachable only via LeadContactReader).
    const schema = read("prisma/schema.prisma");
    for (const name of ["Lead", "LeadPurchase"]) {
      const m = schema.match(new RegExp(`^model ${name} \\{[\\s\\S]*?^\\}`, "m"));
      expect(m, `model ${name}`).not.toBeNull();
      expect(m![0]).not.toMatch(/^\s*(email|phone|addressLine\w*|postalCode|customerName|contact\w*)\s/im);
    }
  });

  it("Module 138: the contact adapter class is instantiated ONLY by the lead-contact composition root", () => {
    const allowed = new Set([
      "src/core/infrastructure/database/prisma/repositories/prisma-lead-contact-access-repository.ts",
      "src/core/application/use-cases/lead-contact/compose.ts",
    ]);
    const offenders = walk(path.join(root, "src"))
      .map((f) => path.relative(root, f))
      .filter((f) => !allowed.has(f))
      .filter((f) => /PrismaLeadContactReader/.test(readFileSync(path.join(root, f), "utf8")));
    expect(offenders).toEqual([]);
  });

  it("Module 138: contact unlock is derived from LeadPurchase.status — no persisted unlock flag", () => {
    const schema = read("prisma/schema.prisma");
    expect(schema).not.toMatch(/contactUnlocked|contact_unlocked|isUnlocked|contactAccess/i);
  });

  it("Module 138: the authorization query is scoped by professional + CONFIRMED inside Prisma", () => {
    const adapter = read("src/core/infrastructure/database/prisma/repositories/prisma-lead-contact-access-repository.ts");
    expect(adapter).toMatch(/where: \{ professionalProfileId, status: "CONFIRMED" \}/);
    const authSide = adapter.slice(adapter.indexOf("class PrismaLeadContactAuthorizationReader"), adapter.indexOf("class PrismaLeadContactReader"));
    expect(authSide).not.toMatch(/email|phone|line1|line2|postalCode|name: true/);
  });

  it("Module 138: contact Server Action takes only a lead id (no professional/purchase id from the client)", () => {
    const actions = read("src/app/(dashboard)/dashboard/professional/leads/actions.ts");
    const fn = actions.slice(actions.indexOf("export async function getLeadContactAction"));
    expect(fn).toMatch(/getLeadContactAction\(leadId: unknown\)/);
    expect(fn).toContain("requireAuth()");
    expect(fn).toContain("execute(user.id, leadId as string)");
    expect(fn).not.toMatch(/professionalProfileId|purchaseId/);
  });

  it("Module 138: purchase / feed / preview DTOs and composition never carry contact fields", () => {
    for (const f of [
      "src/core/application/dto/lead-purchase.dto.ts",
      "src/core/application/dto/lead-feed.dto.ts",
      "src/core/domain/repositories/lead-repository.ts",
    ]) {
      const src = read(f).replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "");
      expect(src, f).not.toMatch(/\b(email|phone|addressLine1|line1|postalCode|customerDisplayName|contactEmail|contactPhone)\b/);
    }
  });
});
