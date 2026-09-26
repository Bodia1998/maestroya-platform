import Link from "next/link";
import { Activity, AlertOctagon, CheckCircle2, ListChecks, PlugZap, XCircle } from "lucide-react";
import { useFormatter, useTranslations } from "next-intl";
import { getTranslations } from "next-intl/server";

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

export async function generateMetadata() {
  const t = await getTranslations("admin");
  return { title: t("common.metaTitle", { page: t("reconciliation.title") }) };
}
export const dynamic = "force-dynamic";

const SEVERITY_ROWS = ["CRITICAL", "ERROR", "WARNING", "INFO"] as const;

function RunSummaryLine({ label, run }: { label: string; run: { id: string; startedAt: Date } | null }) {
  const t = useTranslations("admin.reconciliation.overview");
  const format = useFormatter();
  return (
    <div className="flex items-center justify-between gap-3 text-sm">
      <span className="text-muted-foreground">{label}</span>
      {run ? (
        <Link
          href={`/admin/reconciliation/runs/${run.id}`}
          className="font-medium text-primary underline-offset-2 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring rounded-sm"
        >
          {format.dateTime(new Date(run.startedAt), { dateStyle: "medium", timeStyle: "short" })}
        </Link>
      ) : (
        <span className="text-muted-foreground">{t("noneYet")}</span>
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
  const t = await getTranslations("admin.reconciliation");

  if (!overviewResult.success) {
    return (
      <div className="flex flex-col gap-6">
        <PageHeader title={t("title")} subtitle={t("shortSubtitle")} />
        <p role="alert" className="rounded-md bg-red-100 px-3 py-2 text-sm text-red-700">
          {overviewResult.error}
        </p>
      </div>
    );
  }

  const overview = overviewResult.data;
  const providerLabel = providerResult.success ? providerResult.data.label : t("unknownProvider");

  return (
    <div className="flex flex-col gap-8">
      <PageHeader
        title={t("title")}
        subtitle={t("subtitle")}
        actions={
          <>
            <ButtonLink href="/admin/reconciliation/discrepancies" variant="outline">
              {t("investigate")}
            </ButtonLink>
            <ButtonLink href="/admin/reconciliation/runs" variant="outline">
              {t("viewAllRuns")}
            </ButtonLink>
            <TriggerRunDialog />
          </>
        }
      />

      <section className="flex flex-col gap-4">
        <Heading as="h2" level="h6">
          {t("overview.discrepancies")}
        </Heading>
        <ResponsiveGrid cols="1-2-4">
          <KPICard icon={AlertOctagon} label={t("overview.unresolved")} value={overview.discrepancies.open} href="/admin/reconciliation/discrepancies?resolutionStatus=OPEN" />
          <KPICard icon={CheckCircle2} label={t("overview.resolved")} value={overview.discrepancies.resolved} href="/admin/reconciliation/discrepancies?resolutionStatus=RESOLVED" />
          <KPICard icon={ListChecks} label={t("overview.totalRuns")} value={overview.totalRuns} href="/admin/reconciliation/runs" />
          <KPICard icon={PlugZap} label={t("overview.provider")} value={providerLabel} />
        </ResponsiveGrid>
      </section>

      <section className="flex flex-col gap-4">
        <Heading as="h2" level="h6">
          {t("overview.bySeverity")}
        </Heading>
        <ResponsiveGrid cols="1-2-4">
          {SEVERITY_ROWS.map((severity) => (
            <KPICard
              key={severity}
              icon={severity === "CRITICAL" || severity === "ERROR" ? XCircle : Activity}
              label={t(`severity.${severity}`)}
              value={overview.discrepancies.bySeverity[severity]}
              href={`/admin/reconciliation/discrepancies?resolutionStatus=OPEN&severity=${severity}`}
            />
          ))}
        </ResponsiveGrid>
      </section>

      <ResponsiveGrid cols="1-2-lg" gap="lg">
        <Section title={t("overview.runStatus")} bordered>
          <RunSummaryLine label={t("overview.latestRun")} run={overview.latestRun} />
          {overview.latestRun && (
            <div className="flex items-center justify-between text-sm">
              <span className="text-muted-foreground">{t("overview.status")}</span>
              <RunStatusBadge status={overview.latestRun.status} />
            </div>
          )}
          <RunSummaryLine label={t("overview.lastSuccessfulRun")} run={overview.lastSuccessfulRun} />
          <RunSummaryLine label={t("overview.lastFailedRun")} run={overview.lastFailedRun} />
        </Section>

        <Section title={t("overview.byType")} bordered>
          {overview.discrepancies.byCategory.length === 0 ? (
            <Text size="sm" tone="muted">
              {t("overview.noOpen")}
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
          {t("overview.readOnlyNotice")}
        </CardContent>
      </Card>
    </div>
  );
}
