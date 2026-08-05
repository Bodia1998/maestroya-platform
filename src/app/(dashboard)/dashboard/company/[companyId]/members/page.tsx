import { notFound } from "next/navigation";
import { Users } from "lucide-react";

import { changeCompanyMemberRoleFormAction } from "@/app/(dashboard)/dashboard/company/[companyId]/members/actions";
import { makeGetCompanyForMemberUseCase } from "@/application/use-cases/company/compose";
import { makeListCompanyMembersUseCase } from "@/application/use-cases/company-membership/compose";
import { NotFoundError } from "@/domain/errors/domain-error";
import { requireAuth } from "@/infrastructure/auth/rbac";
import { PageHeader } from "@/components/dashboard/page-header";
import { PageContainer } from "@/components/layout/page-container";
import { Section } from "@/components/layout/section";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { Label } from "@/components/ui/label";
import { Select } from "@/components/ui/select";
import { CompanyTabNav } from "../company-tab-nav";
import { RemoveMemberButton } from "./remove-member-button";
import { TransferOwnershipDialog } from "./transfer-ownership-dialog";

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

  const transferCandidates = activeMembers
    .filter((m) => m.role !== "OWNER")
    .map((m) => ({ id: m.id, label: m.userName ?? m.userEmail ?? m.id }));

  return (
    <PageContainer gap="sm">
      <CompanyTabNav companyId={companyId} active="members" />

      <PageHeader
        title="Members"
        subtitle={`${activeMembers.length} active member(s).`}
        breadcrumbs={[
          { label: company.tradeName ?? company.legalName, href: `/dashboard/company/${companyId}/profile` },
          { label: "Members" },
        ]}
      />

      {members.length === 0 ? (
        <EmptyState
          icon={Users}
          title="No company members yet"
          description="Invite teammates from the Invitations tab to start collaborating on this company account."
        />
      ) : (
        <div className="overflow-x-auto rounded-lg border border-border">
          <table className="w-full min-w-[640px] border-collapse text-sm">
            <thead>
              <tr className="border-b border-border bg-muted/40 text-left text-muted-foreground">
                <th className="px-4 py-3 font-medium">Name</th>
                <th className="px-4 py-3 font-medium">Email</th>
                <th className="px-4 py-3 font-medium">Role</th>
                <th className="px-4 py-3 font-medium">Status</th>
                <th className="px-4 py-3 font-medium">Actions</th>
              </tr>
            </thead>
            <tbody>
              {members.map((member) => {
                const status = member.removedAt ? "REMOVED" : member.joinedAt ? "ACTIVE" : "PENDING";
                const statusVariant =
                  status === "ACTIVE" ? "success" : status === "PENDING" ? "warning" : "secondary";
                return (
                  <tr key={member.id} className="border-b border-border/50 last:border-0">
                    <td className="px-4 py-3">{member.userName ?? "—"}</td>
                    <td className="px-4 py-3">{member.userEmail ?? "—"}</td>
                    <td className="px-4 py-3">{member.role}</td>
                    <td className="px-4 py-3">
                      <Badge variant={statusVariant}>{status}</Badge>
                    </td>
                    <td className="px-4 py-3">
                      {status === "ACTIVE" && member.role !== "OWNER" && (
                        <div className="flex flex-wrap items-center gap-2">
                          <form
                            action={changeCompanyMemberRoleFormAction.bind(null, companyId, member.id)}
                            className="flex items-center gap-1.5"
                          >
                            <Label htmlFor={`role-${member.id}`} className="sr-only">
                              Role for {member.userName ?? member.userEmail ?? member.id}
                            </Label>
                            <Select
                              id={`role-${member.id}`}
                              name="role"
                              defaultValue={member.role}
                              className="h-9 min-w-28 text-xs"
                            >
                              <option value="ADMIN">ADMIN</option>
                              <option value="MANAGER">MANAGER</option>
                              <option value="MEMBER">MEMBER</option>
                            </Select>
                            <Button type="submit" variant="outline" size="sm">
                              Update role
                            </Button>
                          </form>
                          <RemoveMemberButton
                            companyId={companyId}
                            memberId={member.id}
                            memberLabel={member.userName ?? member.userEmail ?? member.id}
                          />
                        </div>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {transferCandidates.length > 0 && (
        <Section title="Transfer ownership" bordered divider>
          <p className="text-sm text-muted-foreground">
            Only the current owner can transfer ownership. This action is irreversible without the new
            owner transferring it back.
          </p>
          <TransferOwnershipDialog companyId={companyId} candidates={transferCandidates} />
        </Section>
      )}
    </PageContainer>
  );
}
