import { redirect } from "next/navigation";

import { prisma } from "@/infrastructure/database/prisma/client";
import { requireAuth } from "@/infrastructure/auth/rbac";
import { makeGetProfessionalByUserIdUseCase } from "@/application/use-cases/professional/compose";
import { makeGetProfileUseCase } from "@/application/use-cases/profile/compose";
import { AvatarUpload } from "@/app/(dashboard)/profile/avatar-upload";
import { PageHeader } from "@/components/dashboard/page-header";
import { Section } from "@/components/layout/section";
import { ProfessionalOnboardingForm } from "./professional-onboarding-form";

export const metadata = { title: "Professional onboarding" };

/**
 * Professional Onboarding — the dedicated, lightweight setup flow a
 * "Soy profesional" signup lands on instead of the Customer Dashboard
 * (see middleware.ts, which redirects here whenever `signupIntent ===
 * "PROFESSIONAL"` and the PROVIDER role hasn't been granted yet, and
 * resumes here on every subsequent login until onboarding completes).
 *
 * If a professional profile already exists — middleware wouldn't normally
 * send anyone here in that case, since creating one is exactly what
 * clears `signupIntent`, but a stale bookmark/back-button is still
 * possible — this just forwards to the real Professional Dashboard rather
 * than erroring.
 */
export default async function ProfessionalOnboardingPage() {
  const user = await requireAuth();

  const existing = await makeGetProfessionalByUserIdUseCase().execute(user.id);
  if (existing) {
    redirect("/dashboard/professional");
  }

  const { profile } = await makeGetProfileUseCase().execute(user.id);

  // Static reference data for the category picker — a plain read, not a
  // use case (no business logic), same convention as the main
  // professional dashboard page (dashboard/professional/page.tsx).
  const categories = await prisma.serviceCategory.findMany({
    where: { status: "ACTIVE", deletedAt: null },
    select: { id: true, name: true },
    orderBy: [{ sortOrder: "asc" }, { name: "asc" }],
  });

  return (
    <div className="flex flex-col gap-8">
      <PageHeader
        title="Set up your professional profile"
        subtitle="A few details so customers can find and contact you. You can add more later from your professional dashboard."
      />

      <Section title="Profile photo (optional)" gap="lg">
        <AvatarUpload currentImageUrl={profile.image} />
      </Section>

      <ProfessionalOnboardingForm categories={categories} />
    </div>
  );
}
