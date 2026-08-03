import { prisma } from "@/infrastructure/database/prisma/client";
import { requireAuth } from "@/infrastructure/auth/rbac";
import { getTranslations } from "@/infrastructure/i18n/server-locale";
import { LanguageSwitcher } from "@/components/shared/language-switcher";
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
    <div className="mx-auto flex w-full max-w-2xl flex-col gap-10 px-4 py-10">
      <div>
        <h1 className="text-2xl font-semibold">{t("title")}</h1>
        <p className="mt-1 text-sm text-foreground/70">{t("subtitle")}</p>
      </div>

      <section className="flex flex-col gap-4">
        <h2 className="text-lg font-medium">{t("section.avatar")}</h2>
        <AvatarUpload currentImageUrl={profile.image} />
        <p className="text-xs text-foreground/60">
          This photo is just for your account — it has no effect on professional identity
          verification. Professionals manage that separately from Professional profile → Manage
          identity verification.
        </p>
      </section>

      <section className="flex flex-col gap-4">
        <h2 className="text-lg font-medium">{t("section.details")}</h2>
        <EditProfileForm profile={profile} address={address} languages={languages} />
      </section>

      {/* Module 29 — Internationalization: the user-facing home of the
          language preference. The header switcher is the quick path; this
          is the discoverable one, and the only place that explains what
          the setting does and does not affect. */}
      <section className="flex flex-col gap-4">
        <h2 className="text-lg font-medium">{tSettings("language.title")}</h2>
        <p className="text-sm text-foreground/70">{tSettings("language.description")}</p>
        <LanguageSwitcher variant="list" className="max-w-sm" />
      </section>

      <section className="flex flex-col gap-4">
        <h2 className="text-lg font-medium">{t("section.password")}</h2>
        <ChangePasswordForm hasPassword={profile.hasPassword} />
      </section>

      <section className="flex flex-col gap-4 border-t border-border pt-8">
        <h2 className="text-lg font-medium text-red-700">{t("section.danger")}</h2>
        <p className="text-sm text-foreground/70">
          Deleting your account is reversible only by contacting support — your data is deactivated,
          not immediately erased.
        </p>
        <DeleteAccountDialog hasPassword={profile.hasPassword} />
      </section>
    </div>
  );
}
