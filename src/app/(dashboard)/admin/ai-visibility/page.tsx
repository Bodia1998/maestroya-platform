import { Eye } from "lucide-react";
import { getFormatter, getTranslations } from "next-intl/server";

import { PageHeader } from "@/components/dashboard/page-header";
import { AdminTablePager } from "@/components/dashboard/admin-table-pager";
import { AdminDataTable, AdminTableHeadRow, AdminTh, AdminTableBody, AdminTableRow } from "@/components/dashboard/admin-data-table";
import { EmptyState } from "@/components/ui/empty-state";
import { DEFAULT_PAGE_SIZE } from "@/domain/services/admin-rules";
import { makeGetAiVisibilityMetricsUseCase, makeListAiVisibilityObservationsUseCase } from "@/application/use-cases/ai-visibility/compose";
import { findAiVisibilityQueryById } from "@/shared/content/ai-visibility-queries";
import type { AiVisibilityRate } from "@/application/use-cases/ai-visibility/get-ai-visibility-metrics.use-case";
import { RecordObservationForm } from "./record-observation-form";

export async function generateMetadata() {
  const t = await getTranslations("admin");
  return { title: t("common.metaTitle", { page: t("aiVisibility.title") }) };
}

type SearchParams = Promise<{ page?: string }>;

type AiVisibilityTranslator = Awaited<ReturnType<typeof getTranslations<"admin.aiVisibility">>>;
type Formatter = Awaited<ReturnType<typeof getFormatter>>;

function formatRate(t: AiVisibilityTranslator, format: Formatter, rate: AiVisibilityRate): string {
  if (rate.denominator === 0) return t("rateNotApplicable");
  const ratio = Math.round((rate.numerator / rate.denominator) * 100) / 100;
  return t("rateValue", {
    percent: format.number(ratio, { style: "percent" }),
    numerator: rate.numerator,
    denominator: rate.denominator,
  });
}

/**
 * Module 119 — AI Recommendation Monitoring: internal-only admin
 * reporting surface. Guarded by the shared `(dashboard)/admin/layout.tsx`
 * ADMIN/SUPER_ADMIN check (see that file) — no separate auth check is
 * needed here, same convention as every other `/admin/*` page.
 *
 * Deliberately a minimal reporting surface (Phase 10: "Do not build a
 * large dashboard unless justified. A minimal internal reporting surface
 * is preferred."): a metrics summary (last 30 days), a manual-capture
 * form, and a paginated, read-only observation list. No raw AI response
 * text is ever rendered here beyond the evaluator's own short, bounded
 * `evidenceExcerpt` (see the Prisma model's own doc comment on why full
 * transcripts are never persisted in the first place).
 */
export default async function AdminAiVisibilityPage({ searchParams }: { searchParams: SearchParams }) {
  const params = await searchParams;
  const page = Math.max(1, Number(params.page) || 1);
  const offset = (page - 1) * DEFAULT_PAGE_SIZE;

  const now = new Date();
  const thirtyDaysAgo = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);

  const [metrics, observations] = await Promise.all([
    makeGetAiVisibilityMetricsUseCase().execute({ from: thirtyDaysAgo, to: now }),
    makeListAiVisibilityObservationsUseCase().execute({ limit: DEFAULT_PAGE_SIZE, offset }),
  ]);
  const t = await getTranslations("admin.aiVisibility");
  const tCommon = await getTranslations("admin.common");
  const format = await getFormatter();
  const rate = (value: AiVisibilityRate) => formatRate(t, format, value);
  const enumLabel = (group: string, value: string) =>
    t.has(`${group}.${value}` as never) ? t(`${group}.${value}` as never) : value;

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title={t("title")}
        subtitle={t("subtitle")}
      />

      <section className="rounded-xl border border-border p-4">
        <h2 className="mb-3 text-sm font-medium text-muted-foreground">
          {t("metricsHeading", {
            from: format.dateTime(thirtyDaysAgo, { dateStyle: "medium" }),
            to: format.dateTime(now, { dateStyle: "medium" }),
          })}
        </h2>
        <dl className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
          <MetricItem label={t("metrics.totalObservations")} value={format.number(metrics.totalObservations)} />
          <MetricItem label={t("metrics.mentionRate")} value={rate(metrics.mentionRate)} />
          <MetricItem label={t("metrics.neutralQueryMentionRate")} value={rate(metrics.neutralQueryMentionRate)} />
          <MetricItem label={t("metrics.citationRate")} value={rate(metrics.citationRate)} />
          <MetricItem label={t("metrics.citationCorrectnessRate")} value={rate(metrics.citationCorrectnessRate)} />
          <MetricItem label={t("metrics.correctIdentityRate")} value={rate(metrics.correctIdentityRate)} />
          <MetricItem label={t("metrics.correctGeographicRate")} value={rate(metrics.correctGeographicRate)} />
          <MetricItem label={t("metrics.correctServiceRate")} value={rate(metrics.correctServiceRate)} />
          <MetricItem label={t("metrics.urlProvidedRate")} value={rate(metrics.urlProvidedRate)} />
          <MetricItem label={t("metrics.correctUrlRate")} value={rate(metrics.correctUrlRate)} />
        </dl>

        {metrics.byProvider.length > 0 ? (
          <div className="mt-4">
            <h3 className="mb-2 text-xs font-medium uppercase tracking-wide text-muted-foreground">{t("byProvider")}</h3>
            <ul className="flex flex-col gap-1 text-sm">
              {metrics.byProvider.map((entry) => (
                <li key={entry.key}>
                  {t("byProviderEntry", {
                    provider: enumLabel("provider", entry.key),
                    count: entry.totalObservations,
                    rate: rate(entry.mentionRate),
                  })}
                </li>
              ))}
            </ul>
          </div>
        ) : null}
      </section>

      <RecordObservationForm />

      {observations.length === 0 ? (
        <EmptyState icon={Eye} title={t("empty")} description={t("emptyDescription")} />
      ) : (
        <AdminDataTable caption={t("caption")} minWidth={900}>
          <AdminTableHeadRow>
            <AdminTh>{t("columns.observed")}</AdminTh>
            <AdminTh>{t("columns.query")}</AdminTh>
            <AdminTh>{t("columns.provider")}</AdminTh>
            <AdminTh>{t("columns.mentioned")}</AdminTh>
            <AdminTh>{t("columns.recommendation")}</AdminTh>
            <AdminTh>{t("columns.url")}</AdminTh>
            <AdminTh>{t("columns.citation")}</AdminTh>
          </AdminTableHeadRow>
          <AdminTableBody>
            {observations.map((observation) => (
              <AdminTableRow key={observation.id}>
                <td className="px-4 py-3 whitespace-nowrap">{format.dateTime(observation.observedAt, { dateStyle: "medium", timeStyle: "short" })}</td>
                <td className="px-4 py-3 font-mono text-xs">
                  {observation.queryId}
                  <div className="text-muted-foreground">{findAiVisibilityQueryById(observation.queryId)?.text ?? ""}</div>
                </td>
                <td className="px-4 py-3">
                  {enumLabel("provider", observation.provider)}
                  {observation.providerModel ? ` (${observation.providerModel})` : ""}
                </td>
                <td className="px-4 py-3">{observation.mentioned ? tCommon("yes") : tCommon("no")}</td>
                <td className="px-4 py-3">{enumLabel("recommendation", observation.recommendationClassification)}</td>
                <td className="px-4 py-3">{enumLabel("accuracy", observation.urlAccuracy)}</td>
                <td className="px-4 py-3">{observation.citationPresent
                    ? observation.citationCorrect
                      ? t("citation.correct")
                      : t("citation.unverified")
                    : t("citation.none")}</td>
              </AdminTableRow>
            ))}
          </AdminTableBody>
        </AdminDataTable>
      )}

      <AdminTablePager page={page} hasNextPage={observations.length === DEFAULT_PAGE_SIZE} buildHref={(p) => `/admin/ai-visibility?page=${p}`} />
    </div>
  );
}

function MetricItem({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dt className="text-xs text-muted-foreground">{label}</dt>
      <dd className="text-sm font-medium">{value}</dd>
    </div>
  );
}
