import Image from "next/image";
import Link from "next/link";
import { notFound } from "next/navigation";

import { prisma } from "@/infrastructure/database/prisma/client";
import { NotFoundError } from "@/domain/errors/domain-error";
import { makeGetCompanyPublicProfileUseCase } from "@/application/use-cases/discovery/compose";
import { makeListCompanyPortfolioItemsUseCase } from "@/application/use-cases/portfolio/compose";
import { PageContainer } from "@/components/layout/page-container";
import { Section } from "@/components/layout/section";
import { ResponsiveGrid } from "@/components/layout/responsive-grid";

/**
 * Module 18 — Company Professional: public company profile page —
 * mirrors (marketing)/professionals/[id]/page.tsx. No authentication
 * required. Never renders internal membership, private verification
 * documents, or Stripe/financial data — only the safe fields
 * CompanyPublicProfileRecord exposes.
 */
export default async function PublicCompanyProfilePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;

  let profile;
  try {
    profile = await makeGetCompanyPublicProfileUseCase().getById(id);
  } catch (error) {
    if (error instanceof NotFoundError) notFound();
    throw error;
  }

  const [categories, portfolioItems] = await Promise.all([
    profile.categoryIds.length
      ? prisma.serviceCategory.findMany({ where: { id: { in: profile.categoryIds } }, select: { id: true, name: true } })
      : Promise.resolve([]),
    makeListCompanyPortfolioItemsUseCase().execute(profile.id, { limit: 12, offset: 0 }),
  ]);

  return (
    <PageContainer padded>
      <Link href="/professionals" className="text-sm text-foreground/70 hover:underline">
        ← Back to search
      </Link>

      <div className="flex items-start gap-5">
        <div className="h-20 w-20 shrink-0 overflow-hidden rounded-full bg-black/5">
          {profile.logoUrl && <Image src={profile.logoUrl} alt="" width={80} height={80} className="h-20 w-20 object-cover" />}
        </div>
        <div className="flex flex-col gap-2">
          <h1 className="text-2xl font-semibold">{profile.displayName}</h1>
          {profile.isVerified && (
            <span className="w-fit rounded-full bg-green-100 px-2 py-0.5 text-xs font-medium text-green-800">
              ✓ Verified company
            </span>
          )}
        </div>
      </div>

      {profile.description && (
        <Section title="About" gap="sm">
          <p className="whitespace-pre-line text-sm text-foreground/80">{profile.description}</p>
        </Section>
      )}

      <ResponsiveGrid cols="2" gap="md" bordered>
        <div>
          <p className="text-foreground/60">Team size</p>
          <p className="font-medium">{profile.teamSize}</p>
        </div>
        {profile.averageRating !== null && (
          <div>
            <p className="text-foreground/60">Rating</p>
            <p className="font-medium">
              {profile.averageRating} ({profile.reviewCount})
            </p>
          </div>
        )}
        {(profile.city || profile.province) && (
          <div>
            <p className="text-foreground/60">Based near</p>
            <p className="font-medium">{[profile.city, profile.province].filter(Boolean).join(", ")}</p>
          </div>
        )}
      </ResponsiveGrid>

      {categories.length > 0 && (
        <Section title="Services" gap="sm">
          <div className="flex flex-wrap gap-2">
            {categories.map((category) => (
              <span key={category.id} className="rounded-full bg-black/5 px-3 py-1 text-xs text-foreground/70">
                {category.name}
              </span>
            ))}
          </div>
        </Section>
      )}

      {portfolioItems.length > 0 && (
        <Section title="Portfolio" gap="sm">
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
            {portfolioItems.map((item) => (
              <div key={item.id} className="overflow-hidden rounded-md border border-border">
                <Image src={item.mediaUrl} alt={item.title} width={200} height={150} className="h-28 w-full object-cover" />
                <p className="p-2 text-xs font-medium">{item.title}</p>
              </div>
            ))}
          </div>
        </Section>
      )}
    </PageContainer>
  );
}
