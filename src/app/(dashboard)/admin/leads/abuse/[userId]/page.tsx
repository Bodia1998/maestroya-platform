import { getTranslations } from "next-intl/server";

import { getAdminAbuseSubjectAction } from "../../actions";
import { ImposeBlockDialog, LiftDecisionDialog } from "../../_components/lead-action-forms";
import { BasisBadge, PrivacyNote, SectionNav, ShortId, formatWhen } from "../../_components/lead-ops-ui";
import { AdminDataTable, AdminTableBody, AdminTableHeadRow, AdminTableRow, AdminTh } from "@/components/dashboard/admin-data-table";
import { PageHeader } from "@/components/dashboard/page-header";
import { StatusBadge } from "@/components/dashboard/status-badge";
import { Badge } from "@/components/ui/badge";

export async function generateMetadata() {
  const t = await getTranslations("admin");
  return { title: t("common.metaTitle", { page: t("leadOps.abuse.subjectTitle") }) };
}

/**
 * Module 157 — one account's M156 evidence and decision history. Signals are evidence; only decisions (flags, temporary blocks)
 * can restrict anything, and only the M156 use cases create or lift them. PURCHASE_REJECTED_PROBING is shown as record-only.
 */
export default async function AdminLeadAbuseSubjectPage({ params }: { params: Promise<{ userId: string }> }) {
  const { userId } = await params;
  const result = await getAdminAbuseSubjectAction(userId);
  const t = await getTranslations("admin.leadOps");

  if (!result.success) {
    return (
      <div className="flex flex-col gap-6">
        <PageHeader title={t("abuse.subjectTitle")} />
        <SectionNav active="abuse" />
        <p role="alert" className="rounded-md bg-red-100 px-3 py-2 text-sm text-red-700">
          {result.error}
        </p>
      </div>
    );
  }
  const s = result.data;

  return (
    <div className="flex flex-col gap-8">
      <PageHeader title={t("abuse.subjectTitle")} subtitle={s.subjectUserId} actions={<ImposeBlockDialog subjectUserId={s.subjectUserId} />} />
      <SectionNav active="abuse" />
      <PrivacyNote />
      <p className="text-sm text-muted-foreground">{t("abuse.enforceNote")}</p>

      <section aria-labelledby="decisions" className="flex flex-col gap-2">
        <h2 id="decisions" className="text-lg font-semibold">{t("abuse.decisions")} <BasisBadge basis="RECORDED_FACT" /></h2>
        {s.decisions.length === 0 ? (
          <p className="text-sm text-muted-foreground">{t("detail.none")}</p>
        ) : (
          <AdminDataTable caption={t("abuse.decisions")} minWidth={900}>
            <AdminTableHeadRow>
              <AdminTh>{t("abuse.decision")}</AdminTh>
              <AdminTh>{t("columns.status")}</AdminTh>
              <AdminTh>{t("abuse.origin")}</AdminTh>
              <AdminTh>{t("abuse.rule")}</AdminTh>
              <AdminTh>{t("abuse.decidedAt")}</AdminTh>
              <AdminTh>{t("abuse.expiresAt")}</AdminTh>
              <AdminTh>{t("detail.actions")}</AdminTh>
            </AdminTableHeadRow>
            <AdminTableBody>
              {s.decisions.map((d) => (
                <AdminTableRow key={d.id}>
                  <td className="px-4 py-3">{d.action}{d.restrictedAction ? ` · ${d.restrictedAction}` : ""}</td>
                  <td className="px-4 py-3">
                    <StatusBadge status={d.status} />
                    {d.restrictingNow && <Badge className="ml-2" variant="danger">{t("abuse.restrictingNow")}</Badge>}
                  </td>
                  <td className="px-4 py-3">{d.origin}</td>
                  <td className="px-4 py-3">{d.ruleKey ?? "—"}</td>
                  <td className="px-4 py-3">{formatWhen(d.decidedAt)}</td>
                  <td className="px-4 py-3">{formatWhen(d.expiresAt)}</td>
                  <td className="px-4 py-3">
                    {d.status === "ACTIVE" ? <LiftDecisionDialog decisionId={d.id} isFlag={d.action === "FLAG_FOR_REVIEW"} /> : null}
                  </td>
                </AdminTableRow>
              ))}
            </AdminTableBody>
          </AdminDataTable>
        )}
      </section>

      <section aria-labelledby="signals" className="flex flex-col gap-2">
        <h2 id="signals" className="text-lg font-semibold">{t("detail.signals")} <BasisBadge basis="HEURISTIC_SIGNAL" /></h2>
        <p className="text-sm text-muted-foreground">{t("detail.signalsNote")}</p>
        {s.signals.length === 0 ? (
          <p className="text-sm text-muted-foreground">{t("detail.none")}</p>
        ) : (
          <ul className="flex flex-col gap-1 text-sm">
            {s.signals.map((x) => (
              <li key={x.id}>
                {formatWhen(x.occurredAt)} — {x.signalType} · {x.reliability} · {x.severity}
                {x.observedCount !== null && x.threshold !== null ? ` · ${x.observedCount}/${x.threshold}` : ""}
                {x.targetLeadId && <> · <ShortId id={x.targetLeadId} href={`/admin/leads/${x.targetLeadId}`} /></>}
                {x.recordOnly && <Badge className="ml-2" variant="outline">{t("detail.recordOnly")}</Badge>}
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
