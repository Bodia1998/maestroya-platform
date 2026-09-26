import Link from "next/link";
import { FileText, ShieldCheck } from "lucide-react";
import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";

import { requireAuth } from "@/infrastructure/auth/rbac";
import { makeGetProfessionalByUserIdUseCase } from "@/application/use-cases/professional/compose";
import { PageHeader } from "@/components/dashboard/page-header";
import { PageContainer } from "@/components/layout/page-container";
import { Section } from "@/components/layout/section";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { getLocalizedActiveCategories } from "./category-labels";
import { DeactivateProfessionalDialog } from "./deactivate-professional-dialog";
import { ProfessionalProfileForm } from "./professional-profile-form";
import { ProfessionalServicesForm } from "./professional-services-form";
import { StatusBadges } from "./status-badges";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("professional.dashboard");
  return { title: t("metaTitle") };
}

export default async function ProfessionalDashboardPage() {
  const user = await requireAuth();
  // Never trust a client-supplied id here — the professional profile is
  // always looked up by the authenticated session's own userId, exactly
  // like GetProfileUseCase does for the general User profile.
  const professional = await makeGetProfessionalByUserIdUseCase().execute(user.id);
  const t = await getTranslations("professional.dashboard");

  // Static reference data for the category picker — a plain read, not a
  // use case (no business logic), matching how the Profile page reads
  // reference data directly. See profile/page.tsx for the same convention.
  // Names are localised via `services.categories.<slug>` (Module 120).
  const categories = await getLocalizedActiveCategories();

  return (
    <PageContainer>
      <PageHeader
        title={t("title")}
        subtitle={t("subtitle")}
      />

      {!professional ? (
        <Card>
          <CardHeader>
            <CardTitle>{t("createTitle")}</CardTitle>
          </CardHeader>
          <CardContent>
            <ProfessionalProfileForm professional={null} />
          </CardContent>
        </Card>
      ) : (
        <>
          <Card>
            <CardHeader className="flex flex-row items-center justify-between space-y-0">
              <CardTitle>{t("statusTitle")}</CardTitle>
              <div className="flex items-center gap-4">
                <Link
                  href="/dashboard/professional/self-billing"
                  className="inline-flex items-center gap-1.5 text-sm font-medium text-primary hover:underline"
                >
                  <FileText className="h-4 w-4" aria-hidden />
                  {t("selfBillingLink")}
                </Link>
                <Link
                  href="/dashboard/professional/verification"
                  className="inline-flex items-center gap-1.5 text-sm font-medium text-primary hover:underline"
                >
                  <ShieldCheck className="h-4 w-4" aria-hidden />
                  {t("verificationLink")}
                </Link>
              </div>
            </CardHeader>
            <CardContent>
              <StatusBadges status={professional.status} verificationStatus={professional.verificationStatus} />
            </CardContent>
          </Card>

          <Section title={t("profileDetails")} gap="lg">
            <ProfessionalProfileForm professional={professional} />
          </Section>

          <Section title={t("serviceCategories")} gap="lg">
            <ProfessionalServicesForm
              categories={categories}
              selectedCategoryIds={professional.categoryIds}
            />
          </Section>

          {professional.status === "ACTIVE" && (
            <Section title={t("dangerZone")} titleTone="danger" gap="lg" divider>
              <p className="text-sm text-muted-foreground">
                {t("dangerZoneDescription")}
              </p>
              <DeactivateProfessionalDialog />
            </Section>
          )}
        </>
      )}
    </PageContainer>
  );
}
