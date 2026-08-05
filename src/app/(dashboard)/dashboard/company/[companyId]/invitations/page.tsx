import { notFound } from "next/navigation";
import { Mail } from "lucide-react";

import { createCompanyInvitationFormAction } from "@/app/(dashboard)/dashboard/company/[companyId]/invitations/actions";
import { makeGetCompanyForMemberUseCase } from "@/application/use-cases/company/compose";
import { makeListCompanyInvitationsUseCase } from "@/application/use-cases/company-invitation/compose";
import { NotFoundError } from "@/domain/errors/domain-error";
import { requireAuth } from "@/infrastructure/auth/rbac";
import { PageHeader } from "@/components/dashboard/page-header";
import { PageContainer } from "@/components/layout/page-container";
import { Section } from "@/components/layout/section";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select } from "@/components/ui/select";
import { CompanyTabNav } from "../company-tab-nav";
import { CancelInvitationButton } from "./cancel-invitation-button";

export const metadata = { title: "Company invitations" };

const STATUS_VARIANT: Record<string, "success" | "warning" | "secondary"> = {
  PENDING: "warning",
  ACCEPTED: "success",
};

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
    <PageContainer gap="sm">
      <CompanyTabNav companyId={companyId} active="invitations" />

      <PageHeader
        title="Invitations"
        breadcrumbs={[
          { label: company.tradeName ?? company.legalName, href: `/dashboard/company/${companyId}/profile` },
          { label: "Invitations" },
        ]}
      />

      <Section title="Invite a member" bordered>
        <p className="text-sm text-muted-foreground">
          Only existing MaestroYa users can be invited today. The invitation is valid for 14 days.
        </p>
        <form action={createCompanyInvitationFormAction.bind(null, companyId)} className="flex flex-col gap-3">
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="invite-email">Email</Label>
            <Input id="invite-email" name="email" type="email" required />
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="invite-role">Role</Label>
            <Select id="invite-role" name="role" defaultValue="MEMBER" className="sm:max-w-xs">
              <option value="ADMIN">ADMIN</option>
              <option value="MANAGER">MANAGER</option>
              <option value="MEMBER">MEMBER</option>
            </Select>
          </div>
          <Button type="submit" className="w-fit">
            Send invitation
          </Button>
        </form>
      </Section>

      {invitations.length === 0 ? (
        <EmptyState
          icon={Mail}
          title="No invitations yet"
          description="Invitations you send will appear here until they're accepted or cancelled."
        />
      ) : (
        <div className="overflow-x-auto rounded-lg border border-border">
          <table className="w-full min-w-[560px] border-collapse text-sm">
            <thead>
              <tr className="border-b border-border bg-muted/40 text-left text-muted-foreground">
                <th className="px-4 py-3 font-medium">Email</th>
                <th className="px-4 py-3 font-medium">Role</th>
                <th className="px-4 py-3 font-medium">Status</th>
                <th className="px-4 py-3 font-medium">Expires</th>
                <th className="px-4 py-3 font-medium"></th>
              </tr>
            </thead>
            <tbody>
              {invitations.map((invitation) => (
                <tr key={invitation.id} className="border-b border-border/50 last:border-0">
                  <td className="px-4 py-3">{invitation.email}</td>
                  <td className="px-4 py-3">{invitation.role}</td>
                  <td className="px-4 py-3">
                    <Badge variant={STATUS_VARIANT[invitation.status] ?? "secondary"}>{invitation.status}</Badge>
                  </td>
                  <td className="px-4 py-3">{invitation.expiresAt.toLocaleDateString()}</td>
                  <td className="px-4 py-3">
                    {invitation.status === "PENDING" && (
                      <CancelInvitationButton companyId={companyId} invitationId={invitation.id} email={invitation.email} />
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </PageContainer>
  );
}
