import type { Metadata } from "next";

import { prisma } from "@/infrastructure/database/prisma/client";
import { PrismaServiceCategoryRepository } from "@/infrastructure/database/prisma/repositories/prisma-service-category-repository";
import { CategoryGrid } from "./_sections/category-grid";
import { Hero } from "./_sections/hero";
import { HowItWorks } from "./_sections/how-it-works";
import { ProfessionalCta } from "./_sections/professional-cta";
import { TrustSection } from "./_sections/trust-section";

const TITLE = "MaestroYa — Encuentra profesionales de confianza para tu hogar";
const DESCRIPTION =
  "Describe lo que necesitas y conecta con profesionales verificados cerca de ti: fontanería, electricidad, reformas, limpieza y mucho más.";

/** Module 43 — SEO Infrastructure: the homepage's own title/description
 *  already existed (Module 1) — this only adds the canonical URL and
 *  Open Graph/Twitter overrides the root layout's defaults don't already
 *  cover per-page (root layout's `openGraph.url`/`title`/`description`
 *  happen to already match the homepage, but declaring them here too
 *  keeps this page correct independent of what the layout defaults to). */
export const metadata: Metadata = {
  title: TITLE,
  description: DESCRIPTION,
  alternates: { canonical: "/" },
  openGraph: { title: TITLE, description: DESCRIPTION, url: "/" },
  twitter: { title: TITLE, description: DESCRIPTION },
};

/**
 * Homepage — Server Component, no client-side data fetching for the
 * page-level reads (per docs/ARCHITECTURE.md's convention: TanStack
 * Query is for client-interactive data only).
 *
 * Two category reads, both "plain reference data" reads rather than use
 * cases (matching the existing convention already used by
 * `requests/new`, `dashboard/professional`, and `/professionals`):
 *  - `PrismaServiceCategoryRepository().listActive()` — the exact same
 *    repository call `requests/new` already uses — powers the hero
 *    search widget's category picker with the full flat category list
 *    (parents + sub-professions), matching how every other
 *    category-select in the app is populated.
 *  - a direct top-level-only Prisma read (`parentId: null`) powers the
 *    homepage's visual category grid, which should show broad service
 *    categories (Fontanería, Electricidad, …), not every nested
 *    profession.
 */
export default async function HomePage() {
  const [searchCategories, topLevelCategories] = await Promise.all([
    new PrismaServiceCategoryRepository().listActive(),
    prisma.serviceCategory.findMany({
      where: { status: "ACTIVE", deletedAt: null, parentId: null },
      select: { id: true, name: true, slug: true, iconUrl: true },
      orderBy: [{ sortOrder: "asc" }, { name: "asc" }],
    }),
  ]);

  return (
    <>
      <Hero categories={searchCategories} />
      <CategoryGrid categories={topLevelCategories} />
      <TrustSection />
      <HowItWorks />
      <ProfessionalCta />
    </>
  );
}
