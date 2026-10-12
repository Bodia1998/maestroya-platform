import { redirect } from "next/navigation";
import { Flag } from "lucide-react";
import { getTranslations } from "next-intl/server";

import { listOpenLeadAbuseFlagsAction } from "../actions";
import { LiftDecisionDialog } from "../_components/lead-action-forms";
import { PrivacyNote, SectionNav, ShortId, formatWhen } from "../_components/lead-ops-ui";
import { AdminDataTable, AdminTableBody, AdminTableHeadRow, AdminTableRow, AdminTh } from "@/components/dashboard/admin-data-table";
import { AdminFilterForm } from "@/components/dashboard/admin-filter-form";
import { PageHeader } from "@/components/dashboard/page-header";
import { EmptyState } from "@/components/ui/empty-state";
import { Input } from "@/components/ui/input";
import { isLeadAdminUuid } from "@/domain/services/lead-admin-console";

export async function generateMetadata() {
  const t = await getTranslations("admin");
  return { title: t("common.metaTitle", { page: t("leadOps.sections.abuse") }) };
}

type SearchParams = Promise<{ subject?: string }>;

/** Module 157 — M156 review queue (open flags, oldest first) plus a lookup of one account's signals and decision history. */
export default async function AdminLeadAbusePage({ searchParams }: { searchParams: SearchParams }) {
  const { subject } = await searchParams;
  if (subject && isLeadAdminUuid(subject)) redirect(`/admin/leads/abuse/${subject.trim().toLowerCase()}`);

  const result = await listOpenLeadAbuseFlagsAction();
  const flags = result.success ? result.data : [];
  const t = await getTranslations("admin.leadOps");

  return (
    <div className="flex flex-col gap-6">
      <PageHeader title={t("abuse.title")} subtitle={t("abuse.subtitle")} />
      <SectionNav active="abuse" />
      <PrivacyNote />
      {!result.success && (
        <p role="alert" className="rounded-md bg-red-100 px-3 py-2 text-sm text-red-700">
          {result.error}
        </p>
      )}
      {subject && !isLeadAdminUuid(subject) && (
        <p role="alert" className="rounded-md bg-red-100 px-3 py-2 text-sm text-red-700">
          {t("errors.invalidInput")}
        </p>
      )}
      <AdminFilterForm aria-label={t("abuse.lookup")} submitLabel={t("abuse.lookupSubmit")}>
        <Input name="subject" placeholder={t("abuse.subjectPlaceholder")} aria-label={t("abuse.subjectPlaceholder")} className="min-w-[320px] flex-1" />
      </AdminFilterForm>

      <h2 className="text-lg font-semibold">{t("abuse.openFlags")}</h2>
      {flags.length === 0 ? (
        <EmptyState icon={Flag} title={t("abuse.empty")} description={t("abuse.emptyDescription")} />
      ) : (
        <AdminDataTable caption={t("abuse.openFlags")} minWidth={720}>
          <AdminTableHeadRow>
            <AdminTh>{t("abuse.subject")}</AdminTh>
            <AdminTh>{t("abuse.rule")}</AdminTh>
            <AdminTh>{t("abuse.decidedAt")}</AdminTh>
            <AdminTh>{t("detail.actions")}</AdminTh>
          </AdminTableHeadRow>
          <AdminTableBody>
            {flags.map((f) => (
              <AdminTableRow key={f.id}>
                <td className="px-4 py-3"><ShortId id={f.subjectUserId} href={`/admin/leads/abuse/${f.subjectUserId}`} /></td>
                <td className="px-4 py-3">{f.ruleKey ?? "—"}</td>
                <td className="px-4 py-3">{formatWhen(f.decidedAt)}</td>
                <td className="px-4 py-3"><LiftDecisionDialog decisionId={f.id} isFlag /></td>
              </AdminTableRow>
            ))}
          </AdminTableBody>
        </AdminDataTable>
      )}
    </div>
  );
}
