import { notFound } from "next/navigation";
import Link from "next/link";

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

export const metadata = { title: "Admin — Reconciliation run" };
export const dynamic = "force-dynamic";

function formatDuration(durationMs: number | null): string {
  if (durationMs === null) return "—";
  if (durationMs < 1000) return `${durationMs} ms`;
  return `${(durationMs / 1000).toFixed(1)} s`;
}

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

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title={`Run ${run.id.slice(0, 8)}…`}
        subtitle={`Scope: ${run.scope}`}
        breadcrumbs={[
          { label: "Reconciliation", href: "/admin/reconciliation" },
          { label: "Runs", href: "/admin/reconciliation/runs" },
          { label: run.id.slice(0, 8) },
        ]}
        actions={<RunStatusBadge status={run.status} />}
      />

      <ResponsiveGrid cols="1-2-4" bordered aria-label="Run summary">
        <div>
          <p className="text-muted-foreground">Started</p>
          <p className="font-medium">{new Date(run.startedAt).toLocaleString()}</p>
        </div>
        <div>
          <p className="text-muted-foreground">Completed</p>
          <p className="font-medium">{run.completedAt ? new Date(run.completedAt).toLocaleString() : "—"}</p>
        </div>
        <div>
          <p className="text-muted-foreground">Duration</p>
          <p className="font-medium">{formatDuration(run.durationMs)}</p>
        </div>
        <div>
          <p className="text-muted-foreground">Records inspected</p>
          <p className="font-medium tabular-nums">{run.recordsInspected}</p>
        </div>
        <div>
          <p className="text-muted-foreground">Discrepancies (created + reconfirmed)</p>
          <p className="font-medium tabular-nums">{run.discrepancyCount}</p>
        </div>
        <div>
          <p className="text-muted-foreground">Triggered by</p>
          <p className="font-medium">{run.triggeredByUserId ?? "System / scheduled"}</p>
        </div>
        <div>
          <p className="text-muted-foreground">Parameters hash</p>
          <p className="font-mono text-xs">{run.parametersHash}</p>
        </div>
      </ResponsiveGrid>

      {run.status === "FAILED" && run.errorMessage && (
        <Section title="Failure information" bordered titleTone="danger" className="border-danger/30 bg-danger-muted/30">
          <p className="whitespace-pre-wrap text-sm text-danger">{run.errorMessage}</p>
        </Section>
      )}

      {severityBreakdown && (
        <Section title="Severity breakdown">
          <ResponsiveGrid cols="1-2-4">
            {SEVERITY_ORDER.map((severity) => (
              <div key={severity} className="flex items-center justify-between gap-3 rounded-md border border-border p-3 text-sm">
                <SeverityBadge severity={severity} />
                <span className="font-medium tabular-nums">{severityBreakdown[severity]}</span>
              </div>
            ))}
          </ResponsiveGrid>
        </Section>
      )}

      <Section title={`Discrepancies detected by this run (${discrepancies.length}${discrepancies.length === 100 ? "+" : ""})`}>
        {discrepancies.length === 0 ? (
          <EmptyState icon={CheckCircle2} title="No discrepancies" description="This run completed without detecting any discrepancy." />
        ) : (
          <AdminDataTable caption="Discrepancies for this run" minWidth={720}>
            <AdminTableHeadRow>
              <AdminTh>Discrepancy</AdminTh>
              <AdminTh>Type</AdminTh>
              <AdminTh>Category</AdminTh>
              <AdminTh>Severity</AdminTh>
              <AdminTh>Status</AdminTh>
              <AdminTh>Detected</AdminTh>
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
                  <td className="px-4 py-3">{new Date(d.detectedAt).toLocaleString()}</td>
                </AdminTableRow>
              ))}
            </AdminTableBody>
          </AdminDataTable>
        )}
      </Section>
    </div>
  );
}
