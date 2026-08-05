import {
  acceptCompanyInvitationFormAction,
  declineCompanyInvitationFormAction,
} from "@/app/(dashboard)/dashboard/company/accept-invitation/actions";
import { PageHeader } from "@/components/dashboard/page-header";

export const metadata = { title: "Company invitation" };

type SearchParams = Promise<{ token?: string }>;

/** Module 18 — Company Professional: the landing page an invitation link
 *  points to (`/dashboard/company/accept-invitation?token=...`). Requires
 *  sign-in (this route is under the (dashboard) group, already gated by
 *  middleware's `/dashboard` protected prefix). */
export default async function AcceptCompanyInvitationPage({ searchParams }: { searchParams: SearchParams }) {
  const { token } = await searchParams;

  if (!token) {
    return <p className="text-sm text-foreground/70">This invitation link is missing its token.</p>;
  }

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="Company invitation"
        subtitle="You've been invited to join a company on MaestroYa. Accepting will make you an active member immediately."
      />
      <div className="flex gap-3">
        <form action={acceptCompanyInvitationFormAction.bind(null, token)}>
          <button type="submit" className="h-10 rounded-md bg-black px-4 text-sm font-medium text-white">
            Accept invitation
          </button>
        </form>
        <form action={declineCompanyInvitationFormAction.bind(null, token)}>
          <button type="submit" className="h-10 rounded-md border border-border px-4 text-sm">
            Decline
          </button>
        </form>
      </div>
    </div>
  );
}
