import { prisma } from "@/infrastructure/database/prisma/client";

/**
 * Module 118 — AI-Readable Service & Location Knowledge.
 *
 * Live verification for the public location pages, reading the existing
 * `Country`/`Province`/`City` Prisma models (Module 117's report already
 * identified these as sufficient for this module — "no new data model
 * required"). A plain reference-data read, not a use case, same
 * convention as `verified-service-category.ts`.
 *
 * The match is by name (case-insensitive), not id, because
 * `locations.ts`'s curated content is keyed by the human-readable
 * city/province/country names an editor writes, not by a database id
 * that would need to be hardcoded and could drift silently if the row
 * were ever re-seeded. A caller getting `null` back must 404 — never
 * render `locations.ts`'s copy for a place that turned out not to exist
 * in this environment's database.
 */
export interface VerifiedLocation {
  id: string;
  cityName: string;
  provinceName: string;
  countryCode: string;
}

export async function findVerifiedCity(
  cityName: string,
  provinceName: string,
  countryCode: string,
): Promise<VerifiedLocation | null> {
  const city = await prisma.city.findFirst({
    where: {
      name: { equals: cityName, mode: "insensitive" },
      province: {
        name: { equals: provinceName, mode: "insensitive" },
        country: { code: countryCode },
      },
    },
    select: {
      id: true,
      name: true,
      province: { select: { name: true, country: { select: { code: true } } } },
    },
  });

  if (!city) return null;

  return {
    id: city.id,
    cityName: city.name,
    provinceName: city.province.name,
    countryCode: city.province.country.code,
  };
}
