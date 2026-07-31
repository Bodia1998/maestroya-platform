import { readFileSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

/**
 * Regression coverage for the Language schema/domain-model regression:
 * `prisma/schema.prisma` was manually restored from an older snapshot that
 * predated the `sortOrder` migration and post-dated the (never-shipped)
 * "professional spoken languages" feature removal, so it simultaneously
 * lost `Language.sortOrder` (breaking the seed script and every read of the
 * platform-language picker) and re-introduced the removed
 * `ProfessionalProfile.languages` relation. Application code (seed.ts,
 * profile/page.tsx, PrismaLanguageRepository) always expected the
 * *corrected* shape, so a plain typecheck against a regenerated Prisma
 * Client is the real regression detector — but schema.prisma itself is a
 * declarative config file with no compiler of its own, so these tests
 * assert directly on its text to catch a future accidental revert before it
 * ever reaches `prisma generate`.
 */

const schemaPath = path.resolve(__dirname, "../../../prisma/schema.prisma");
const schema = readFileSync(schemaPath, "utf-8");

function extractModelBlock(modelName: string): string {
  const start = schema.indexOf(`model ${modelName} {`);
  if (start === -1) {
    throw new Error(`model ${modelName} not found in schema.prisma`);
  }
  const end = schema.indexOf("\n}", start);
  if (end === -1) {
    throw new Error(`closing brace for model ${modelName} not found`);
  }
  return schema.slice(start, end);
}

describe("prisma/schema.prisma — Language model contract", () => {
  it("declares Language.sortOrder as a required Int with a default", () => {
    const languageModel = extractModelBlock("Language");
    expect(languageModel).toMatch(/sortOrder\s+Int\s+@default\(0\)/);
  });

  it("does not declare a Language <-> ProfessionalProfile relation", () => {
    const languageModel = extractModelBlock("Language");
    expect(languageModel).not.toMatch(/professionalProfiles/);
    expect(languageModel).not.toMatch(/ProfessionalLanguages/);
  });

  it("keeps the User <-> Language preferred-language relation intact", () => {
    const languageModel = extractModelBlock("Language");
    // The platform-language picker relies on this relation continuing to
    // exist — this test guards against an over-eager future cleanup
    // removing it along with the (correctly removed) professional relation.
    expect(languageModel).toMatch(/users\s+User\[\]/);
  });
});

describe("prisma/schema.prisma — ProfessionalProfile model contract", () => {
  it("does not declare a languages relation to Language", () => {
    const professionalProfileModel = extractModelBlock("ProfessionalProfile");
    expect(professionalProfileModel).not.toMatch(/languages\s+Language\[\]/);
    expect(professionalProfileModel).not.toMatch(/ProfessionalLanguages/);
  });

  it("still declares the (unrelated, legitimate) categories relation", () => {
    const professionalProfileModel = extractModelBlock("ProfessionalProfile");
    expect(professionalProfileModel).toMatch(/categories\s+ServiceCategory\[\]/);
  });
});
