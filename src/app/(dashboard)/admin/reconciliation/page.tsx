import Link from "next/link";
import { Activity, AlertOctagon, CheckCircle2, ListChecks, PlugZap, XCircle } from "lucide-react";

import { getReconciliationOverviewAction, getReconciliationProviderBindingAction } from "./actions";
import { PageHeader } from "@/components/dashboard/page-header";
import { KPICard } from "@/components/dashboard/kpi-card";
import { ResponsiveGrid } from "@/components/layout/responsive-grid";
import { Section } from "@/components/layout/section";
import { Card, CardContent } from "@/components/ui/card";
import { Heading, Text } from "@/components/ui/typography";
import { ButtonLink } from "@/components/ui/button-link";
import { RunStatusBadge } from "./_components/badges";
import { TriggerRunDialog } from "./_components/trigger-run-dialog";

export const metadata = { title: "Admin — Reconciliation" };
export const dynamic = "force-dynamic";

const SEVERITY_ROWS: Array<{ key: "CRITICAL" | "ERROR" | "WARNING" | "INFO"; label: string }> = [
  { key: "CRITICAL", label: "Critical" },
  { key: "ERROR", label: "High" },
  { key: "WARNING", label: "Medium" },
  { key: "INFO", label: "Low" },
];

function RunSummaryLine({ label, run }: { label: string; run: { id: string; startedAt: Date } | null }) {
  return (
    <div className="flex items-center justify-between gap-3 text-sm">
      <span className="text-muted-foreground">{label}</span>
      {run ? (
        <Link
          href={`/admin/reconciliation/runs/${run.id}`}
          className="font-medium text-primary underline-offset-2 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring rounded-sm"
        >
          {new Date(run.startedAt).toLocaleString()}
        </Link>
      ) : (
        <span className="text-muted-foreground">None yet</span>
      )}
    </div>
  );
}

/**
 * Module 81 — Reconciliation Admin Dashboard & Operations: the admin
 * overview for Module 80's financial reconciliation subsystem. Every
 * number here comes straight from `GetReconciliationOverviewUseCase` (a
 * Module 81 addition composing only Module 80's own repository queries,
 * plus two the discrepancy repository didn't have yet — see that use
 * case's doc comment) — nothing on this page is computed client-side or
 * invented; a metric Module 80 genuinely doesn't expose is simply not
 * shown.
 */
export default async function AdminReconciliationOverviewPage() {
  const [overviewResult, providerResult] = await Promise.all([
    getReconciliationOverviewAction(),
    getReconciliationProviderBindingAction(),
  ]);

  if (!overviewResult.success) {
    return (
      <div className="flex flex-col gap-6">
        <PageHeader title="Reconciliation" subtitle="Financial reconciliation runs and discrepancies." />
        <p role="alert" className="rounded-md bg-red-100 px-3 py-2 text-sm text-red-700">
          {overviewResult.error}
        </p>
      </div>
    );
  }

  const overview = overviewResult.data;
  const providerLabel = providerResult.success ? providerResult.data.label : "Unknown";

  return (
    <div className="flex flex-col gap-8">
      <PageHeader
        title="Reconciliation"
        subtitle="Financial reconciliation runs and discrepancies across Payments, Commission, Tax, Invoicing, Payouts, Refunds, and Credit Notes."
        actions={
          <>
            <ButtonLink href="/admin/reconciliation/discrepancies" variant="outline">
              Investigate discrepancies
            </ButtonLink>
            <ButtonLink href="/admin/reconciliation/runs" variant="outline">
              View all runs
            </ButtonLink>
            <TriggerRunDialog />
          </>
        }
      />

      <section className="flex flex-col gap-4">
        <Heading as="h2" level="h6">
          Discrepancies
        </Heading>
        <ResponsiveGrid cols="1-2-4">
          <KPICard icon={AlertOctagon} label="Unresolved discrepancies" value={overview.discrepancies.open} href="/admin/reconciliation/discrepancies?resolutionStatus=OPEN" />
          <KPICard icon={CheckCircle2} label="Resolved discrepancies" value={overview.discrepancies.resolved} href="/admin/reconciliation/discrepancies?resolutionStatus=RESOLVED" />
          <KPICard icon={ListChecks} label="Total reconciliation runs" value={overview.totalRuns} href="/admin/reconciliation/runs" />
          <KPICard icon={PlugZap} label="Provider adapter" value={providerLabel} />
        </ResponsiveGrid>
      </section>

      <section className="flex flex-col gap-4">
        <Heading as="h2" level="h6">
          Open discrepancies by severity
        </Heading>
        <ResponsiveGrid cols="1-2-4">
          {SEVERITY_ROWS.map((row) => (
            <KPICard
              key={row.key}
              icon={row.key === "CRITICAL" || row.key === "ERROR" ? XCircle : Activity}
              label={row.label}
              value={overview.discrepancies.bySeverity[row.key]}
              href={`/admin/reconciliation/discrepancies?resolutionStatus=OPEN&severity=${row.key}`}
            />
          ))}
        </ResponsiveGrid>
      </section>

      <ResponsiveGrid cols="1-2-lg" gap="lg">
        <Section title="Run status" bordered>
          <RunSummaryLine label="Latest run" run={overview.latestRun} />
          {overview.latestRun && (
            <div className="flex items-center justify-between text-sm">
              <span className="text-muted-foreground">Status</span>
              <RunStatusBadge status={overview.latestRun.status} />
            </div>
          )}
          <RunSummaryLine label="Last successful run" run={overview.lastSuccessfulRun} />
          <RunSummaryLine label="Last failed run" run={overview.lastFailedRun} />
        </Section>

        <Section title="Open discrepancies by type" bordered>
          {overview.discrepancies.byCategory.length === 0 ? (
            <Text size="sm" tone="muted">
              No open discrepancies detected.
            </Text>
          ) : (
            <ul className="flex flex-col gap-1.5">
              {overview.discrepancies.byCategory.slice(0, 8).map((row) => (
                <li key={row.category} className="flex items-center justify-between gap-3 text-sm">
                  <span className="truncate text-muted-foreground">{row.category.replaceAll("_", " ").toLowerCase()}</span>
                  <span className="font-medium tabular-nums">{row.count}</span>
                </li>
              ))}
            </ul>
          )}
        </Section>
      </ResponsiveGrid>

      <Card>
        <CardContent className="p-5 text-sm text-muted-foreground">
          Reconciliation is read-only with respect to every financial record it inspects — it only detects and
          records discrepancies here for manual review. Resolving a discrepancy never changes a Payment, Invoice,
          Payout, Refund, or Credit Note; it only closes this investigation.
        </CardContent>
      </Card>
    </div>
  );
}
