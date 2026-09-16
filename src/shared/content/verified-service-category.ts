import { prisma } from "@/infrastructure/database/prisma/client";

/**
 * Module 118 — AI-Readable Service & Location Knowledge.
 *
 * Live verification for the public service pages — deliberately a plain
 * Prisma read, not a use case (no business logic; same "plain reference
 * data" convention `(marketing)/page.tsx` and `(marketing)/search/page.tsx`
 * already use for their own `ServiceCategory` reads).
 *
 * Only ever returns a category that is ACTIVE, not soft-deleted, and
 * top-level (`parentId: null`) — matching this module's conceptual
 * architecture of one public page per broad category (Fontanería,
 * Electricidad, …), never per nested profession (Fontanero). A caller
 * getting `null` back must 404, never fall back to `services.ts`'s
 * static copy alone — see that file's own doc comment.
 */
export interface VerifiedServiceCategory {
  id: string;
  slug: string;
  name: string;
  description: string | null;
}

export async function findVerifiedTopLevelServiceCategory(
  slug: string,
): Promise<VerifiedServiceCategory | null> {
  return prisma.serviceCategory.findFirst({
    where: { slug, status: "ACTIVE", deletedAt: null, parentId: null },
    select: { id: true, slug: true, name: true, description: true },
  });
}

export async function listVerifiedTopLevelServiceCategories(): Promise<VerifiedServiceCategory[]> {
  return prisma.serviceCategory.findMany({
    where: { status: "ACTIVE", deletedAt: null, parentId: null },
    select: { id: true, slug: true, name: true, description: true },
    orderBy: [{ sortOrder: "asc" }, { name: "asc" }],
  });
}
