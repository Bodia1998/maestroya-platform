import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";

import { requireAuth } from "@/infrastructure/auth/rbac";
import { makeListLeadRequestCategoriesUseCase } from "@/application/use-cases/lead-request/compose";
import { PageHeader } from "@/components/dashboard/page-header";
import { localizeCategoryName } from "@/presentation/i18n/service-categories";
import { getLeadFeedAction } from "./actions";
import { LeadMarketplace } from "./lead-marketplace";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("professional.leads");
  return { title: t("metaTitle") };
}

/**
 * Module 143 — professional LEAD_V1 marketplace. Presentation only: the first page
 * comes from the Module 134 feed Server Action (identity from the session, never
 * from the URL or the client) and later pages through the same action. Eligibility,
 * publication readiness, pricing, own-request exclusion and keyset pagination all
 * stay in the Module 134 use case; this page renders what it returns. Category
 * names are only localized for display, from the backend-authoritative M142 list.
 */
export default async function ProfessionalLeadMarketplacePage() {
  await requireAuth();

  const [t, tServices, firstPage, categories] = await Promise.all([
    getTranslations("professional.leads"),
    getTranslations("services"),
    getLeadFeedAction().catch(() => null),
    makeListLeadRequestCategoriesUseCase()
      .execute()
      .catch(() => []),
  ]);

  const categoryNames: Record<string, string> = {};
  for (const category of categories) categoryNames[category.id] = localizeCategoryName(tServices, category);

  return (
    <div className="flex flex-col gap-6">
      <PageHeader title={t("title")} subtitle={t("subtitle")} />
      <LeadMarketplace
        initialItems={firstPage?.success ? firstPage.items : []}
        initialNextCursor={firstPage?.success ? firstPage.nextCursor : null}
        initialFailed={!firstPage?.success}
        categoryNames={categoryNames}
      />
    </div>
  );
}
