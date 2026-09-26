import { notFound } from "next/navigation";
import Link from "next/link";
import { getFormatter, getTranslations } from "next-intl/server";

import {
  getReconciliationRunAction,
  getReconciliationRunSeverityBreakdownAction,
  listDiscrepanciesForRunAction,
} from "../../actions";
import { PageHeader } from "@/components/dashboard/page-header";
import { ResponsiveGrid } from "@/components/layout/responsive-grid";
import { Section } from "@/components/layout/section";
import { AdminDataTable, AdminTableHeadRow, AdminTh, AdminTableBody, AdminTableRow } from "@/components/dashboard/admin-data-table";
import { EmptyState } from "@/components/ui/empty-state";
import { CheckCircle2 } from "lucide-react";
import { RunStatusBadge, SeverityBadge, ResolutionStatusBadge } from "../../_components/badges";
import { formatDuration } from "../../_components/format-duration";

export async function generateMetadata() {
  const t = await getTranslations("admin");
  return { title: t("common.metaTitle", { page: t("reconciliation.runDetail.metaTitle") }) };
}
export const dynamic = "force-dynamic";

const SEVERITY_ORDER = ["CRITICAL", "ERROR", "WARNING", "INFO"] as const;

/**
 * Module 81 — Reconciliation Admin Dashboard & Operations: the run detail
 * view — everything an admin needs to understand what happened during one
 * `ReconciliationRun` without touching the database directly (spec
 * section 6). `runId` comes straight from the URL segment; the underlying
 * `getReconciliationRunAction`/`GetReconciliationRunUseCase` do the actual
 * lookup and throw `NotFoundError` for a run id that doesn't exist or
 * isn't a valid UUID — this page only translates that into Next's
 * `notFound()`, it never trusts the id for anything beyond that lookup
 * (no direct Prisma access, no assumption the id is well-formed).
 */
export default async function AdminReconciliationRunDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;

  const [runResult, severityResult, discrepanciesResult] = await Promise.all([
    getReconciliationRunAction(id),
    getReconciliationRunSeverityBreakdownAction(id),
    listDiscrepanciesForRunAction({ runId: id, limit: 100, offset: 0 }),
  ]);

  if (!runResult.success) {
    notFound();
  }

  const run = runResult.data;
  const severityBreakdown = severityResult.success ? severityResult.data : null;
  const discrepancies = discrepanciesResult.success ? discrepanciesResult.data : [];
  const t = await getTranslations("admin.reconciliation");
  const format = await getFormatter();
  const dateTime = (value: Date) => format.dateTime(new Date(value), { dateStyle: "medium", timeStyle: "short" });
  const scopeLabel = t.has(`scope.${run.scope}` as never) ? t(`scope.${run.scope}` as never) : run.scope;

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title={t("runDetail.title", { id: run.id.slice(0, 8) })}
        subtitle={t("runDetail.scope", { scope: scopeLabel })}
        breadcrumbs={[
          { label: t("title"), href: "/admin/reconciliation" },
          { label: t("runs.breadcrumb"), href: "/admin/reconciliation/runs" },
          { label: run.id.slice(0, 8) },
        ]}
        actions={<RunStatusBadge status={run.status} />}
      />

      <ResponsiveGrid cols="1-2-4" bordered aria-label={t("runDetail.summary")}>
        <div>
          <p className="text-muted-foreground">{t("runDetail.started")}</p>
          <p className="font-medium">{dateTime(run.startedAt)}</p>
        </div>
        <div>
          <p className="text-muted-foreground">{t("runDetail.completed")}</p>
          <p className="font-medium">{run.completedAt ? dateTime(run.completedAt) : "—"}</p>
        </div>
        <div>
          <p className="text-muted-foreground">{t("runDetail.duration")}</p>
          <p className="font-medium">{formatDuration(t, run.durationMs)}</p>
        </div>
        <div>
          <p className="text-muted-foreground">{t("runDetail.recordsInspected")}</p>
          <p className="font-medium tabular-nums">{format.number(run.recordsInspected)}</p>
        </div>
        <div>
          <p className="text-muted-foreground">{t("runDetail.discrepancyCount")}</p>
          <p className="font-medium tabular-nums">{format.number(run.discrepancyCount)}</p>
        </div>
        <div>
          <p className="text-muted-foreground">{t("runDetail.triggeredBy")}</p>
          <p className="font-medium">{run.triggeredByUserId ?? t("runDetail.system")}</p>
        </div>
        <div>
          <p className="text-muted-foreground">{t("runDetail.parametersHash")}</p>
          <p className="font-mono text-xs">{run.parametersHash}</p>
        </div>
      </ResponsiveGrid>

      {run.status === "FAILED" && run.errorMessage && (
        <Section title={t("runDetail.failure")} bordered titleTone="danger" className="border-danger/30 bg-danger-muted/30">
          <p className="whitespace-pre-wrap text-sm text-danger">{run.errorMessage}</p>
        </Section>
      )}

      {severityBreakdown && (
        <Section title={t("runDetail.severityBreakdown")}>
          <ResponsiveGrid cols="1-2-4">
            {SEVERITY_ORDER.map((severity) => (
              <div key={severity} className="flex items-center justify-between gap-3 rounded-md border border-border p-3 text-sm">
                <SeverityBadge severity={severity} />
                <span className="font-medium tabular-nums">{format.number(severityBreakdown[severity])}</span>
              </div>
            ))}
          </ResponsiveGrid>
        </Section>
      )}

      <Section
        title={t("runDetail.discrepancies", {
          count: discrepancies.length,
          more: discrepancies.length === 100 ? "true" : "false",
        })}
      >
        {discrepancies.length === 0 ? (
          <EmptyState icon={CheckCircle2} title={t("runDetail.noDiscrepancies")} description={t("runDetail.noDiscrepanciesDescription")} />
        ) : (
          <AdminDataTable caption={t("runDetail.caption")} minWidth={720}>
            <AdminTableHeadRow>
              <AdminTh>{t("discrepancies.columns.discrepancy")}</AdminTh>
              <AdminTh>{t("discrepancies.columns.type")}</AdminTh>
              <AdminTh>{t("runDetail.columns.category")}</AdminTh>
              <AdminTh>{t("discrepancies.columns.severity")}</AdminTh>
              <AdminTh>{t("discrepancies.columns.status")}</AdminTh>
              <AdminTh>{t("discrepancies.columns.detected")}</AdminTh>
            </AdminTableHeadRow>
            <AdminTableBody>
              {discrepancies.map((d) => (
                <AdminTableRow key={d.id}>
                  <td className="px-4 py-3">
                    <Link
                      href={`/admin/reconciliation/discrepancies/${d.id}`}
                      className="font-mono text-xs text-primary underline-offset-2 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring rounded-sm"
                    >
                      {d.id.slice(0, 8)}…
                    </Link>
                  </td>
                  <td className="px-4 py-3">{d.entityType}</td>
                  <td className="px-4 py-3 text-xs">{d.category.replaceAll("_", " ").toLowerCase()}</td>
                  <td className="px-4 py-3">
                    <SeverityBadge severity={d.severity} />
                  </td>
                  <td className="px-4 py-3">
                    <ResolutionStatusBadge status={d.resolutionStatus} />
                  </td>
                  <td className="px-4 py-3">{dateTime(d.detectedAt)}</td>
                </AdminTableRow>
              ))}
            </AdminTableBody>
          </AdminDataTable>
        )}
      </Section>
    </div>
  );
}
