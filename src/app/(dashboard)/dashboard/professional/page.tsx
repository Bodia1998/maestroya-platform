import Link from "next/link";

import { prisma } from "@/infrastructure/database/prisma/client";
import { requireAuth } from "@/infrastructure/auth/rbac";
import { makeGetProfessionalByUserIdUseCase } from "@/application/use-cases/professional/compose";
import { PageHeader } from "@/components/dashboard/page-header";
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
    <div className="mx-auto flex w-full max-w-2xl flex-col gap-10">
      <PageHeader
        title="Professional profile"
        subtitle="Manage how you appear to customers as an individual professional."
      />

      {!professional ? (
        <section className="flex flex-col gap-4">
          <h2 className="text-lg font-medium">Create your professional profile</h2>
          <ProfessionalProfileForm professional={null} />
        </section>
      ) : (
        <>
          <section className="flex flex-col gap-3">
            <h2 className="text-lg font-medium">Status</h2>
            <StatusBadges
              status={professional.status}
              verificationStatus={professional.verificationStatus}
            />
            <Link href="/dashboard/professional/verification" className="w-fit text-sm underline">
              Manage identity verification →
            </Link>
          </section>

          <section className="flex flex-col gap-4">
            <h2 className="text-lg font-medium">Profile details</h2>
            <ProfessionalProfileForm professional={professional} />
          </section>

          <section className="flex flex-col gap-4">
            <h2 className="text-lg font-medium">Service categories</h2>
            <ProfessionalServicesForm
              categories={categories}
              selectedCategoryIds={professional.categoryIds}
            />
          </section>

          {professional.status === "ACTIVE" && (
            <section className="flex flex-col gap-4 border-t border-border pt-8">
              <h2 className="text-lg font-medium text-red-700">Danger zone</h2>
              <DeactivateProfessionalDialog />
            </section>
          )}
        </>
      )}
    </div>
  );
}
