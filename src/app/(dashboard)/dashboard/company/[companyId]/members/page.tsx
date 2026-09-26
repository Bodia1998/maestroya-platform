import { notFound } from "next/navigation";
import { Users } from "lucide-react";
import { getTranslations } from "next-intl/server";

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

export async function generateMetadata() {
  const t = await getTranslations("company.members");
  return { title: t("metaTitle") };
}

const ASSIGNABLE_ROLES = ["ADMIN", "MANAGER", "MEMBER"] as const;
const ROLE_KEYS = ["OWNER", "ADMIN", "MANAGER", "MEMBER"] as const;
type RoleKey = (typeof ROLE_KEYS)[number];
function isRoleKey(role: string): role is RoleKey {
  return (ROLE_KEYS as readonly string[]).includes(role);
}

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

  const t = await getTranslations("company");
  const members = await makeListCompanyMembersUseCase().execute(user.id, companyId);
  const activeMembers = members.filter((m) => m.joinedAt && !m.removedAt);

  const transferCandidates = activeMembers
    .filter((m) => m.role !== "OWNER")
    .map((m) => ({ id: m.id, label: m.userName ?? m.userEmail ?? m.id }));

  return (
    <PageContainer gap="sm">
      <CompanyTabNav companyId={companyId} active="members" />

      <PageHeader
        title={t("members.title")}
        subtitle={t("members.activeCount", { count: activeMembers.length })}
        breadcrumbs={[
          { label: company.tradeName ?? company.legalName, href: `/dashboard/company/${companyId}/profile` },
          { label: t("members.title") },
        ]}
      />

      {members.length === 0 ? (
        <EmptyState
          icon={Users}
          title={t("members.emptyTitle")}
          description={t("members.emptyDescription")}
        />
      ) : (
        <div className="overflow-x-auto rounded-lg border border-border">
          <table className="w-full min-w-[640px] border-collapse text-sm">
            <thead>
              <tr className="border-b border-border bg-muted/40 text-left text-muted-foreground">
                <th className="px-4 py-3 font-medium">{t("members.columns.name")}</th>
                <th className="px-4 py-3 font-medium">{t("members.columns.email")}</th>
                <th className="px-4 py-3 font-medium">{t("members.columns.role")}</th>
                <th className="px-4 py-3 font-medium">{t("members.columns.status")}</th>
                <th className="px-4 py-3 font-medium">{t("members.columns.actions")}</th>
              </tr>
            </thead>
            <tbody>
              {members.map((member) => {
                const status = (member.removedAt ? "REMOVED" : member.joinedAt ? "ACTIVE" : "PENDING") as "REMOVED" | "ACTIVE" | "PENDING";
                const statusVariant =
                  status === "ACTIVE" ? "success" : status === "PENDING" ? "warning" : "secondary";
                return (
                  <tr key={member.id} className="border-b border-border/50 last:border-0">
                    <td className="px-4 py-3">{member.userName ?? "—"}</td>
                    <td className="px-4 py-3">{member.userEmail ?? "—"}</td>
                    <td className="px-4 py-3">{isRoleKey(member.role) ? t(`roles.${member.role}`) : member.role}</td>
                    <td className="px-4 py-3">
                      <Badge variant={statusVariant}>{t(`memberStatus.${status}`)}</Badge>
                    </td>
                    <td className="px-4 py-3">
                      {status === "ACTIVE" && member.role !== "OWNER" && (
                        <div className="flex flex-wrap items-center gap-2">
                          <form
                            action={changeCompanyMemberRoleFormAction.bind(null, companyId, member.id)}
                            className="flex items-center gap-1.5"
                          >
                            <Label htmlFor={`role-${member.id}`} className="sr-only">
                              {t("members.roleFor", { name: member.userName ?? member.userEmail ?? member.id })}
                            </Label>
                            <Select
                              id={`role-${member.id}`}
                              name="role"
                              defaultValue={member.role}
                              className="h-9 min-w-28 text-xs"
                            >
                              {ASSIGNABLE_ROLES.map((role) => (
                                <option key={role} value={role}>
                                  {t(`roles.${role}`)}
                                </option>
                              ))}
                            </Select>
                            <Button type="submit" variant="outline" size="sm">
                              {t("members.updateRole")}
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
        <Section title={t("members.transferTitle")} bordered divider>
          <p className="text-sm text-muted-foreground">
            {t("members.transferNotice")}
          </p>
          <TransferOwnershipDialog companyId={companyId} candidates={transferCandidates} />
        </Section>
      )}
    </PageContainer>
  );
}
