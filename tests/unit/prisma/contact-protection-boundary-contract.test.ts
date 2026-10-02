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

  it("LeadContactReader is only consumed by GetLeadContactUseCase (and its port/tests)", () => {
    const allowed = new Set([
      "src/core/application/ports/lead-contact-access.ts",
      "src/core/application/use-cases/lead-contact/get-lead-contact.use-case.ts",
    ]);
    const offenders = walk(path.join(root, "src"))
      .map((f) => path.relative(root, f))
      .filter((f) => !allowed.has(f))
      .filter((f) => /LeadContactReader|readContact\(/.test(readFileSync(path.join(root, f), "utf8")));
    expect(offenders).toEqual([]);
  });

  it("does not introduce Lead / LeadPurchase tables yet (Module 123)", () => {
    const schema = read("prisma/schema.prisma");
    expect(schema).not.toMatch(/^model Lead(Purchase)?\s*\{/m);
  });
});
