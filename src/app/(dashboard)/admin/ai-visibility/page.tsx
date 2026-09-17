import { Eye } from "lucide-react";

import { PageHeader } from "@/components/dashboard/page-header";
import { AdminTablePager } from "@/components/dashboard/admin-table-pager";
import { AdminDataTable, AdminTableHeadRow, AdminTh, AdminTableBody, AdminTableRow } from "@/components/dashboard/admin-data-table";
import { EmptyState } from "@/components/ui/empty-state";
import { DEFAULT_PAGE_SIZE } from "@/domain/services/admin-rules";
import { makeGetAiVisibilityMetricsUseCase, makeListAiVisibilityObservationsUseCase } from "@/application/use-cases/ai-visibility/compose";
import { findAiVisibilityQueryById } from "@/shared/content/ai-visibility-queries";
import type { AiVisibilityRate } from "@/application/use-cases/ai-visibility/get-ai-visibility-metrics.use-case";
import { RecordObservationForm } from "./record-observation-form";

export const metadata = { title: "Admin — AI visibility" };

type SearchParams = Promise<{ page?: string }>;

function formatRate(rate: AiVisibilityRate): string {
  if (rate.denominator === 0) return "n/a (0 observations)";
  const pct = Math.round((rate.numerator / rate.denominator) * 100);
  return `${pct}% (${rate.numerator}/${rate.denominator})`;
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

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="AI visibility"
        subtitle="Objective, timestamped observations of how external AI/search systems respond to MaestroYa-related queries. These are individual observations, not a stable ranking — AI output is inherently variable."
      />

      <section className="rounded-xl border border-border p-4">
        <h2 className="mb-3 text-sm font-medium text-muted-foreground">
          Last 30 days ({thirtyDaysAgo.toLocaleDateString()} – {now.toLocaleDateString()}), excluding neutral-intent queries unless noted
        </h2>
        <dl className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
          <MetricItem label="Total observations" value={String(metrics.totalObservations)} />
          <MetricItem label="Mention rate" value={formatRate(metrics.mentionRate)} />
          <MetricItem label="Neutral-query mention rate" value={formatRate(metrics.neutralQueryMentionRate)} />
          <MetricItem label="Citation present (of mentioned)" value={formatRate(metrics.citationRate)} />
          <MetricItem label="Citation correct (of cited)" value={formatRate(metrics.citationCorrectnessRate)} />
          <MetricItem label="Correct identity (of mentioned)" value={formatRate(metrics.correctIdentityRate)} />
          <MetricItem label="Correct geography (of mentioned)" value={formatRate(metrics.correctGeographicRate)} />
          <MetricItem label="Correct service (of mentioned)" value={formatRate(metrics.correctServiceRate)} />
          <MetricItem label="URL provided (of mentioned)" value={formatRate(metrics.urlProvidedRate)} />
          <MetricItem label="Correct URL (of provided)" value={formatRate(metrics.correctUrlRate)} />
        </dl>

        {metrics.byProvider.length > 0 ? (
          <div className="mt-4">
            <h3 className="mb-2 text-xs font-medium uppercase tracking-wide text-muted-foreground">By provider</h3>
            <ul className="flex flex-col gap-1 text-sm">
              {metrics.byProvider.map((entry) => (
                <li key={entry.key}>
                  {entry.key}: {entry.totalObservations} observations, mention rate {formatRate(entry.mentionRate)}
                </li>
              ))}
            </ul>
          </div>
        ) : null}
      </section>

      <RecordObservationForm />

      {observations.length === 0 ? (
        <EmptyState icon={Eye} title="No observations recorded yet" description="Recorded AI visibility observations will appear here." />
      ) : (
        <AdminDataTable caption="AI visibility observations" minWidth={900}>
          <AdminTableHeadRow>
            <AdminTh>Observed</AdminTh>
            <AdminTh>Query</AdminTh>
            <AdminTh>Provider</AdminTh>
            <AdminTh>Mentioned</AdminTh>
            <AdminTh>Recommendation</AdminTh>
            <AdminTh>URL</AdminTh>
            <AdminTh>Citation</AdminTh>
          </AdminTableHeadRow>
          <AdminTableBody>
            {observations.map((observation) => (
              <AdminTableRow key={observation.id}>
                <td className="px-4 py-3 whitespace-nowrap">{observation.observedAt.toLocaleString()}</td>
                <td className="px-4 py-3 font-mono text-xs">
                  {observation.queryId}
                  <div className="text-muted-foreground">{findAiVisibilityQueryById(observation.queryId)?.text ?? ""}</div>
                </td>
                <td className="px-4 py-3">
                  {observation.provider}
                  {observation.providerModel ? ` (${observation.providerModel})` : ""}
                </td>
                <td className="px-4 py-3">{observation.mentioned ? "Yes" : "No"}</td>
                <td className="px-4 py-3">{observation.recommendationClassification}</td>
                <td className="px-4 py-3">{observation.urlAccuracy}</td>
                <td className="px-4 py-3">{observation.citationPresent ? (observation.citationCorrect ? "Present, correct" : "Present, unverified/incorrect") : "None"}</td>
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
