import { notFound } from "next/navigation";

import {
  cancelCompanyInvitationFormAction,
  createCompanyInvitationFormAction,
} from "@/app/(dashboard)/dashboard/company/[companyId]/invitations/actions";
import { makeGetCompanyForMemberUseCase } from "@/application/use-cases/company/compose";
import { makeListCompanyInvitationsUseCase } from "@/application/use-cases/company-invitation/compose";
import { NotFoundError } from "@/domain/errors/domain-error";
import { requireAuth } from "@/infrastructure/auth/rbac";

export const metadata = { title: "Company invitations" };

/** Module 18 — Company Professional: invitation management — invite an
 *  existing user by email, list every invitation (any status), cancel a
 *  pending one. The invite/cancel forms are safe to render for any active
 *  member — CreateCompanyInvitationUseCase/CancelCompanyInvitationUseCase
 *  re-check OWNER/ADMIN authorization server-side. */
export default async function CompanyInvitationsPage({ params }: { params: Promise<{ companyId: string }> }) {
  const { companyId } = await params;
  const user = await requireAuth();

  let company;
  try {
    company = await makeGetCompanyForMemberUseCase().execute(user.id, companyId);
  } catch (error) {
    if (error instanceof NotFoundError) notFound();
    throw error;
  }

  const invitations = await makeListCompanyInvitationsUseCase().execute(user.id, companyId);

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-2xl font-semibold">Invitations — {company.tradeName ?? company.legalName}</h1>
      </div>

      <section className="rounded-md border border-border p-4">
        <h2 className="text-lg font-medium">Invite a member</h2>
        <p className="mt-1 text-sm text-foreground/70">
          Only existing MaestroYa users can be invited today. The invitation is valid for 14 days.
        </p>
        <form action={createCompanyInvitationFormAction.bind(null, companyId)} className="mt-3 flex flex-col gap-3">
          <label className="flex flex-col gap-1 text-sm">
            <span className="text-foreground/70">Email</span>
            <input name="email" type="email" required className="rounded-md border border-border p-2 text-sm" />
          </label>
          <label className="flex flex-col gap-1 text-sm">
            <span className="text-foreground/70">Role</span>
            <select name="role" defaultValue="MEMBER" className="rounded-md border border-border p-2 text-sm">
              <option value="ADMIN">ADMIN</option>
              <option value="MANAGER">MANAGER</option>
              <option value="MEMBER">MEMBER</option>
            </select>
          </label>
          <button type="submit" className="h-10 w-fit rounded-md bg-black px-4 text-sm font-medium text-white">
            Send invitation
          </button>
        </form>
      </section>

      {invitations.length === 0 ? (
        <p className="rounded-md border border-dashed border-border p-6 text-center text-sm text-foreground/70">
          No invitations yet.
        </p>
      ) : (
        <table className="w-full border-collapse text-sm">
          <thead>
            <tr className="border-b border-border text-left text-foreground/70">
              <th className="py-2 pr-4">Email</th>
              <th className="py-2 pr-4">Role</th>
              <th className="py-2 pr-4">Status</th>
              <th className="py-2 pr-4">Expires</th>
              <th className="py-2 pr-4"></th>
            </tr>
          </thead>
          <tbody>
            {invitations.map((invitation) => (
              <tr key={invitation.id} className="border-b border-border/50">
                <td className="py-2 pr-4">{invitation.email}</td>
                <td className="py-2 pr-4">{invitation.role}</td>
                <td className="py-2 pr-4">{invitation.status}</td>
                <td className="py-2 pr-4">{invitation.expiresAt.toLocaleDateString()}</td>
                <td className="py-2 pr-4">
                  {invitation.status === "PENDING" && (
                    <form action={cancelCompanyInvitationFormAction.bind(null, companyId, invitation.id)}>
                      <button type="submit" className="rounded-md border border-border px-2 py-1 text-xs">
                        Cancel
                      </button>
                    </form>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}
