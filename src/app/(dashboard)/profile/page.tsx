import { prisma } from "@/infrastructure/database/prisma/client";
import { requireAuth } from "@/infrastructure/auth/rbac";
import { makeGetProfileUseCase } from "@/application/use-cases/profile/compose";
import { AvatarUpload } from "./avatar-upload";
import { ChangePasswordForm } from "./change-password-form";
import { DeleteAccountDialog } from "./delete-account-dialog";
import { EditProfileForm } from "./edit-profile-form";

export const metadata = { title: "Profile" };

export default async function ProfilePage() {
  const user = await requireAuth();
  const { profile, address } = await makeGetProfileUseCase().execute(user.id);

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
        <h1 className="text-2xl font-semibold">Profile</h1>
        <p className="mt-1 text-sm text-foreground/70">
          Manage your account details and preferences.
        </p>
      </div>

      <section className="flex flex-col gap-4">
        <h2 className="text-lg font-medium">Avatar</h2>
        <AvatarUpload currentImageUrl={profile.image} />
        <p className="text-xs text-foreground/60">
          This photo is just for your account — it has no effect on professional identity
          verification. Professionals manage that separately from Professional profile → Manage
          identity verification.
        </p>
      </section>

      <section className="flex flex-col gap-4">
        <h2 className="text-lg font-medium">Profile details</h2>
        <EditProfileForm profile={profile} address={address} languages={languages} />
      </section>

      <section className="flex flex-col gap-4">
        <h2 className="text-lg font-medium">Change password</h2>
        <ChangePasswordForm hasPassword={profile.hasPassword} />
      </section>

      <section className="flex flex-col gap-4 border-t border-border pt-8">
        <h2 className="text-lg font-medium text-red-700">Danger zone</h2>
        <p className="text-sm text-foreground/70">
          Deleting your account is reversible only by contacting support — your data is
          deactivated, not immediately erased.
        </p>
        <DeleteAccountDialog hasPassword={profile.hasPassword} />
      </section>
    </div>
  );
}
