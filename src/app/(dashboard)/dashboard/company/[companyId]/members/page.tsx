import { notFound } from "next/navigation";

import {
  changeCompanyMemberRoleFormAction,
  removeCompanyMemberFormAction,
  transferCompanyOwnershipFormAction,
} from "@/app/(dashboard)/dashboard/company/[companyId]/members/actions";
import { makeGetCompanyForMemberUseCase } from "@/application/use-cases/company/compose";
import { makeListCompanyMembersUseCase } from "@/application/use-cases/company-membership/compose";
import { NotFoundError } from "@/domain/errors/domain-error";
import { requireAuth } from "@/infrastructure/auth/rbac";
import { PageHeader } from "@/components/dashboard/page-header";

export const metadata = { title: "Company members" };

/** Module 18 — Company Professional: members management. Role-change/
 *  remove/transfer-ownership forms are always safe to render for any
 *  active member — the underlying Server Actions re-check
 *  canChangeMemberRole/canRemoveMember/canInitiateOwnershipTransfer
 *  server-side, so a MANAGER/MEMBER submitting one gets a rejected result,
 *  never a silently-succeeding mutation. */
export default async function CompanyMembersPage({ params }: { params: Promise<{ companyId: string }> }) {
  const { companyId } = await params;
  const user = await requireAuth();

  let company;
  try {
    company = await makeGetCompanyForMemberUseCase().execute(user.id, companyId);
  } catch (error) {
    if (error instanceof NotFoundError) notFound();
    throw error;
  }

  const members = await makeListCompanyMembersUseCase().execute(user.id, companyId);
  const activeMembers = members.filter((m) => m.joinedAt && !m.removedAt);

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="Members"
        subtitle={`${activeMembers.length} active member(s).`}
        breadcrumbs={[
          { label: company.tradeName ?? company.legalName, href: `/dashboard/company/${companyId}/profile` },
          { label: "Members" },
        ]}
      />

      <table className="w-full border-collapse text-sm">
        <thead>
          <tr className="border-b border-border text-left text-foreground/70">
            <th className="py-2 pr-4">Name</th>
            <th className="py-2 pr-4">Email</th>
            <th className="py-2 pr-4">Role</th>
            <th className="py-2 pr-4">Status</th>
            <th className="py-2 pr-4">Actions</th>
          </tr>
        </thead>
        <tbody>
          {members.map((member) => {
            const status = member.removedAt ? "REMOVED" : member.joinedAt ? "ACTIVE" : "PENDING";
            return (
              <tr key={member.id} className="border-b border-border/50">
                <td className="py-2 pr-4">{member.userName ?? "—"}</td>
                <td className="py-2 pr-4">{member.userEmail ?? "—"}</td>
                <td className="py-2 pr-4">{member.role}</td>
                <td className="py-2 pr-4">{status}</td>
                <td className="py-2 pr-4">
                  {status === "ACTIVE" && member.role !== "OWNER" && (
                    <div className="flex flex-wrap gap-2">
                      <form action={changeCompanyMemberRoleFormAction.bind(null, companyId, member.id)} className="flex gap-1">
                        <select name="role" defaultValue={member.role} className="rounded-md border border-border p-1 text-xs">
                          <option value="ADMIN">ADMIN</option>
                          <option value="MANAGER">MANAGER</option>
                          <option value="MEMBER">MEMBER</option>
                        </select>
                        <button type="submit" className="rounded-md border border-border px-2 py-1 text-xs">
                          Update role
                        </button>
                      </form>
                      <form action={removeCompanyMemberFormAction.bind(null, companyId, member.id)}>
                        <button type="submit" className="rounded-md border border-border px-2 py-1 text-xs">
                          Remove
                        </button>
                      </form>
                    </div>
                  )}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>

      <section className="rounded-md border border-border p-4">
        <h2 className="text-lg font-medium">Transfer ownership</h2>
        <p className="mt-1 text-sm text-foreground/70">
          Only the current owner can transfer ownership. This action is irreversible without the new owner
          transferring it back.
        </p>
        <form action={transferCompanyOwnershipFormAction.bind(null, companyId)} className="mt-3 flex flex-col gap-3">
          <label className="flex flex-col gap-1 text-sm">
            <span className="text-foreground/70">New owner (member id)</span>
            <select name="newOwnerMemberId" className="rounded-md border border-border p-2 text-sm">
              {activeMembers
                .filter((m) => m.role !== "OWNER")
                .map((m) => (
                  <option key={m.id} value={m.id}>
                    {m.userName ?? m.userEmail ?? m.id}
                  </option>
                ))}
            </select>
          </label>
          <label className="flex flex-col gap-1 text-sm">
            <span className="text-foreground/70">Type TRANSFER to confirm</span>
            <input name="confirmationText" required className="rounded-md border border-border p-2 text-sm" />
          </label>
          <button type="submit" className="h-10 w-fit rounded-md border border-border px-4 text-sm">
            Transfer ownership
          </button>
        </form>
      </section>
    </div>
  );
}
