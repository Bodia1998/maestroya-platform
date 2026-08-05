import { getTranslations } from "next-intl/server";

import { prisma } from "@/infrastructure/database/prisma/client";
import { requireAuth } from "@/infrastructure/auth/rbac";
import { LanguageSwitcher } from "@/components/shared/language-switcher";
import { PageHeader } from "@/components/dashboard/page-header";
import { PageContainer } from "@/components/layout/page-container";
import { Section } from "@/components/layout/section";
import { makeGetProfileUseCase } from "@/application/use-cases/profile/compose";
import { AvatarUpload } from "./avatar-upload";
import { ChangePasswordForm } from "./change-password-form";
import { DeleteAccountDialog } from "./delete-account-dialog";
import { EditProfileForm } from "./edit-profile-form";

export const metadata = { title: "Profile" };

export default async function ProfilePage() {
  const user = await requireAuth();
  const [{ profile, address }, t, tSettings] = await Promise.all([
    makeGetProfileUseCase().execute(user.id),
    getTranslations("profile"),
    getTranslations("settings"),
  ]);

  // Static reference data for the language dropdown — not a use case
  // (no business logic, just a lookup list), so read directly here per
  // the "never access Prisma directly from use cases" rule, which scopes
  // the restriction to use cases specifically, not simple page-level
  // reference-data reads.
  const languages = await prisma.language.findMany({
    where: { isActive: true },
    select: { id: true, name: true, nativeName: true },
    orderBy: [{ sortOrder: "asc" }, { name: "asc" }],
  });

  return (
    <PageContainer gap="lg">
      <PageHeader title={t("title")} subtitle={t("subtitle")} />

      <Section title={t("section.avatar")} gap="lg">
        <AvatarUpload currentImageUrl={profile.image} />
        <p className="text-xs text-foreground/60">
          This photo is just for your account — it has no effect on professional identity
          verification. Professionals manage that separately from Professional profile → Manage
          identity verification.
        </p>
      </Section>

      <Section title={t("section.details")} gap="lg">
        <EditProfileForm profile={profile} address={address} languages={languages} />
      </Section>

      {/* Module 29 — Internationalization: the user-facing home of the
          language preference. The header switcher is the quick path; this
          is the discoverable one, and the only place that explains what
          the setting does and does not affect. */}
      <Section title={tSettings("language.title")} gap="lg">
        <p className="text-sm text-foreground/70">{tSettings("language.description")}</p>
        <LanguageSwitcher variant="list" className="max-w-sm" />
      </Section>

      <Section title={t("section.password")} gap="lg">
        <ChangePasswordForm hasPassword={profile.hasPassword} />
      </Section>

      <Section title={t("section.danger")} titleTone="danger" gap="lg" divider>
        <p className="text-sm text-foreground/70">
          Deleting your account is reversible only by contacting support — your data is deactivated,
          not immediately erased.
        </p>
        <DeleteAccountDialog hasPassword={profile.hasPassword} />
      </Section>
    </PageContainer>
  );
}
