import { getTranslations } from "next-intl/server";

import {
  acceptCompanyInvitationFormAction,
  declineCompanyInvitationFormAction,
} from "@/app/(dashboard)/dashboard/company/accept-invitation/actions";
import { PageHeader } from "@/components/dashboard/page-header";

export async function generateMetadata() {
  const t = await getTranslations("company.acceptInvitation");
  return { title: t("metaTitle") };
}

type SearchParams = Promise<{ token?: string }>;

/** Module 18 — Company Professional: the landing page an invitation link
 *  points to (`/dashboard/company/accept-invitation?token=...`). Requires
 *  sign-in (this route is under the (dashboard) group, already gated by
 *  middleware's `/dashboard` protected prefix). */
export default async function AcceptCompanyInvitationPage({ searchParams }: { searchParams: SearchParams }) {
  const { token } = await searchParams;
  const t = await getTranslations("company.acceptInvitation");

  if (!token) {
    return <p className="text-sm text-foreground/70">{t("missingToken")}</p>;
  }

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title={t("title")}
        subtitle={t("subtitle")}
      />
      <div className="flex gap-3">
        <form action={acceptCompanyInvitationFormAction.bind(null, token)}>
          <button type="submit" className="h-10 rounded-md bg-black px-4 text-sm font-medium text-white">
            {t("accept")}
          </button>
        </form>
        <form action={declineCompanyInvitationFormAction.bind(null, token)}>
          <button type="submit" className="h-10 rounded-md border border-border px-4 text-sm">
            {t("decline")}
          </button>
        </form>
      </div>
    </div>
  );
}
