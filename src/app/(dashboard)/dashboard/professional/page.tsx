import Link from "next/link";
import { ShieldCheck } from "lucide-react";

import { prisma } from "@/infrastructure/database/prisma/client";
import { requireAuth } from "@/infrastructure/auth/rbac";
import { makeGetProfessionalByUserIdUseCase } from "@/application/use-cases/professional/compose";
import { PageHeader } from "@/components/dashboard/page-header";
import { PageContainer } from "@/components/layout/page-container";
import { Section } from "@/components/layout/section";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { DeactivateProfessionalDialog } from "./deactivate-professional-dialog";
import { ProfessionalProfileForm } from "./professional-profile-form";
import { ProfessionalServicesForm } from "./professional-services-form";
import { StatusBadges } from "./status-badges";

export const metadata = { title: "Professional profile" };

export default async function ProfessionalDashboardPage() {
  const user = await requireAuth();
  // Never trust a client-supplied id here — the professional profile is
  // always looked up by the authenticated session's own userId, exactly
  // like GetProfileUseCase does for the general User profile.
  const professional = await makeGetProfessionalByUserIdUseCase().execute(user.id);

  // Static reference data for the category picker — a plain read, not a
  // use case (no business logic), matching how the Profile page reads
  // reference data directly. See profile/page.tsx for the same convention.
  const categories = await prisma.serviceCategory.findMany({
    where: { status: "ACTIVE", deletedAt: null },
    select: { id: true, name: true },
    orderBy: [{ sortOrder: "asc" }, { name: "asc" }],
  });

  return (
    <PageContainer>
      <PageHeader
        title="Professional profile"
        subtitle="Manage how you appear to customers as an individual professional."
      />

      {!professional ? (
        <Card>
          <CardHeader>
            <CardTitle>Create your professional profile</CardTitle>
          </CardHeader>
          <CardContent>
            <ProfessionalProfileForm professional={null} />
          </CardContent>
        </Card>
      ) : (
        <>
          <Card>
            <CardHeader className="flex flex-row items-center justify-between space-y-0">
              <CardTitle>Status</CardTitle>
              <Link
                href="/dashboard/professional/verification"
                className="inline-flex items-center gap-1.5 text-sm font-medium text-primary hover:underline"
              >
                <ShieldCheck className="h-4 w-4" aria-hidden />
                Manage identity verification
              </Link>
            </CardHeader>
            <CardContent>
              <StatusBadges status={professional.status} verificationStatus={professional.verificationStatus} />
            </CardContent>
          </Card>

          <Section title="Profile details" gap="lg">
            <ProfessionalProfileForm professional={professional} />
          </Section>

          <Section title="Service categories" gap="lg">
            <ProfessionalServicesForm
              categories={categories}
              selectedCategoryIds={professional.categoryIds}
            />
          </Section>

          {professional.status === "ACTIVE" && (
            <Section title="Danger zone" titleTone="danger" gap="lg" divider>
              <p className="text-sm text-muted-foreground">
                Deactivating your profile removes it from customer search until reactivated.
              </p>
              <DeactivateProfessionalDialog />
            </Section>
          )}
        </>
      )}
    </PageContainer>
  );
}
