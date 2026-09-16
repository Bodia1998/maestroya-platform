import { prisma } from "@/infrastructure/database/prisma/client";

/**
 * Module 118 (continuation) — Spain-wide geographic coverage.
 *
 * Live verification for the Spain-wide coverage page
 * (`/ubicaciones/espana`), reading the existing `Country` Prisma model —
 * the same model `verified-location.ts` already reads one level down
 * (`Country` → `Province` → `City`). No schema change: `prisma/seed.ts`
 * already seeds exactly one `Country` row (`code: "ES", name: "Spain"`),
 * which is the platform's own real, top-of-hierarchy geographic record —
 * not a fabricated one introduced for this page.
 *
 * Same discipline as every other verification helper in this module: a
 * caller getting `null` back must 404, never render the national-coverage
 * copy for a country this environment's database does not actually have.
 */
export interface VerifiedCountry {
  id: string;
  code: string;
  name: string;
}

export async function findVerifiedCountry(code: string): Promise<VerifiedCountry | null> {
  return prisma.country.findFirst({
    where: { code },
    select: { id: true, code: true, name: true },
  });
}
