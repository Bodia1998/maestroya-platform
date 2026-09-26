import { notFound } from "next/navigation";
import { Mail } from "lucide-react";
import { getFormatter, getTranslations } from "next-intl/server";

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

export async function generateMetadata() {
  const t = await getTranslations("company.invitations");
  return { title: t("metaTitle") };
}

const ASSIGNABLE_ROLES = ["ADMIN", "MANAGER", "MEMBER"] as const;
const ROLE_KEYS = ["OWNER", "ADMIN", "MANAGER", "MEMBER"] as const;
const INVITATION_STATUS_KEYS = ["PENDING", "ACCEPTED", "DECLINED", "EXPIRED", "CANCELLED"] as const;
function isOneOf<T extends string>(values: readonly T[], value: string): value is T {
  return (values as readonly string[]).includes(value);
}

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

  const t = await getTranslations("company");
  const format = await getFormatter();
  const invitations = await makeListCompanyInvitationsUseCase().execute(user.id, companyId);

  return (
    <PageContainer gap="sm">
      <CompanyTabNav companyId={companyId} active="invitations" />

      <PageHeader
        title={t("invitations.title")}
        breadcrumbs={[
          { label: company.tradeName ?? company.legalName, href: `/dashboard/company/${companyId}/profile` },
          { label: t("invitations.title") },
        ]}
      />

      <Section title={t("invitations.inviteTitle")} bordered>
        <p className="text-sm text-muted-foreground">
          {t("invitations.inviteNotice")}
        </p>
        <form action={createCompanyInvitationFormAction.bind(null, companyId)} className="flex flex-col gap-3">
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="invite-email">{t("invitations.email")}</Label>
            <Input id="invite-email" name="email" type="email" required />
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="invite-role">{t("invitations.role")}</Label>
            <Select id="invite-role" name="role" defaultValue="MEMBER" className="sm:max-w-xs">
              {ASSIGNABLE_ROLES.map((role) => (
                <option key={role} value={role}>
                  {t(`roles.${role}`)}
                </option>
              ))}
            </Select>
          </div>
          <Button type="submit" className="w-fit">
            {t("invitations.send")}
          </Button>
        </form>
      </Section>

      {invitations.length === 0 ? (
        <EmptyState
          icon={Mail}
          title={t("invitations.emptyTitle")}
          description={t("invitations.emptyDescription")}
        />
      ) : (
        <div className="overflow-x-auto rounded-lg border border-border">
          <table className="w-full min-w-[560px] border-collapse text-sm">
            <thead>
              <tr className="border-b border-border bg-muted/40 text-left text-muted-foreground">
                <th className="px-4 py-3 font-medium">{t("invitations.columns.email")}</th>
                <th className="px-4 py-3 font-medium">{t("invitations.columns.role")}</th>
                <th className="px-4 py-3 font-medium">{t("invitations.columns.status")}</th>
                <th className="px-4 py-3 font-medium">{t("invitations.columns.expires")}</th>
                <th className="px-4 py-3 font-medium">
                  <span className="sr-only">{t("invitations.columns.actions")}</span>
                </th>
              </tr>
            </thead>
            <tbody>
              {invitations.map((invitation) => (
                <tr key={invitation.id} className="border-b border-border/50 last:border-0">
                  <td className="px-4 py-3">{invitation.email}</td>
                  <td className="px-4 py-3">
                    {isOneOf(ROLE_KEYS, invitation.role) ? t(`roles.${invitation.role}`) : invitation.role}
                  </td>
                  <td className="px-4 py-3">
                    <Badge variant={STATUS_VARIANT[invitation.status] ?? "secondary"}>{isOneOf(INVITATION_STATUS_KEYS, invitation.status)
                        ? t(`invitationStatus.${invitation.status}`)
                        : invitation.status}
                    </Badge>
                  </td>
                  <td className="px-4 py-3">{format.dateTime(invitation.expiresAt, { dateStyle: "medium" })}</td>
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
