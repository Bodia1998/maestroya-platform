import { notFound } from "next/navigation";
import Link from "next/link";
import { getFormatter, getTranslations } from "next-intl/server";

import { getFinancialEntitySnapshotAction, getReconciliationDiscrepancyAction } from "../../actions";
import { PageHeader } from "@/components/dashboard/page-header";
import { ResponsiveGrid } from "@/components/layout/responsive-grid";
import { Section } from "@/components/layout/section";
import { SeverityBadge, ResolutionStatusBadge } from "../../_components/badges";
import { ResolveDiscrepancyDialog } from "./resolve-discrepancy-dialog";

export async function generateMetadata() {
  const t = await getTranslations("admin");
  return { title: t("common.metaTitle", { page: t("reconciliation.discrepancyDetail.metaTitle") }) };
}
export const dynamic = "force-dynamic";

/**
 * Module 81 — Reconciliation Admin Dashboard & Operations: the discrepancy
 * investigation page (spec section 9). Composed entirely from Module 80's
 * own DTOs — `ReconciliationDiscrepancyRecord` already carries every field
 * this page shows (identity, financial info, references, timeline,
 * resolution) — plus, where a `jobId` exists, a drill-down link into
 * `GetFinancialEntitySnapshotUseCase`'s own read-only job snapshot. No
 * secret, API credential, or raw provider payload is rendered anywhere on
 * this page — only the already-redacted `PaymentRecord`/`InvoiceRecord`/
 * etc. shapes those use cases return.
 *
 * Module 80 exposed no single-discrepancy read path — only `listForRun`/
 * `listUnresolved` (both lists) — even though `ReconciliationDiscrepancyRepository.findById`
 * already existed. `getReconciliationDiscrepancyAction` (added alongside
 * this page — see `GetDiscrepancyByIdUseCase`) is the minimal addition
 * that exposes it, rather than this page reaching into the repository
 * directly or approximating an id lookup from a filtered list.
 */
export default async function AdminDiscrepancyDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;

  const result = await getReconciliationDiscrepancyAction(id);
  if (!result.success) {
    notFound();
  }
  const discrepancy = result.data;

  const snapshotResult = discrepancy.jobId ? await getFinancialEntitySnapshotAction({ jobId: discrepancy.jobId }) : null;
  const snapshot = snapshotResult?.success ? snapshotResult.data : null;
  const t = await getTranslations("admin.reconciliation");
  const format = await getFormatter();
  const dateTime = (value: Date) => format.dateTime(new Date(value), { dateStyle: "medium", timeStyle: "short" });

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title={t("discrepancyDetail.title", { id: discrepancy.id.slice(0, 8) })}
        subtitle={discrepancy.category.replaceAll("_", " ").toLowerCase()}
        breadcrumbs={[
          { label: t("title"), href: "/admin/reconciliation" },
          { label: t("discrepancies.title"), href: "/admin/reconciliation/discrepancies" },
          { label: discrepancy.id.slice(0, 8) },
        ]}
        actions={
          <>
            <SeverityBadge severity={discrepancy.severity} />
            <ResolutionStatusBadge status={discrepancy.resolutionStatus} />
          </>
        }
      />

      <p className="whitespace-pre-wrap text-sm">{discrepancy.explanation}</p>

      <Section title={t("discrepancyDetail.identity")} bordered>
        <ResponsiveGrid cols="1-2-lg">
          <div>
            <p className="text-muted-foreground">{t("discrepancyDetail.entityType")}</p>
            <p className="font-medium">{discrepancy.entityType}</p>
          </div>
          <div>
            <p className="text-muted-foreground">{t("discrepancyDetail.fingerprint")}</p>
            <p className="font-mono text-xs">{discrepancy.fingerprint}</p>
          </div>
        </ResponsiveGrid>
      </Section>

      <Section title={t("discrepancyDetail.financial")} bordered>
        <ResponsiveGrid cols="1-2-4">
          <div>
            <p className="text-muted-foreground">{t("discrepancyDetail.internalAmount")}</p>
            <p className="font-medium tabular-nums">
              {discrepancy.expectedValue !== null ? format.number(discrepancy.expectedValue, { style: "currency", currency: discrepancy.currency ?? "EUR" }) : "—"}
            </p>
          </div>
          <div>
            <p className="text-muted-foreground">{t("discrepancyDetail.providerAmount")}</p>
            <p className="font-medium tabular-nums">
              {discrepancy.actualValue !== null ? format.number(discrepancy.actualValue, { style: "currency", currency: discrepancy.currency ?? "EUR" }) : "—"}
            </p>
          </div>
          <div>
            <p className="text-muted-foreground">{t("discrepancyDetail.difference")}</p>
            <p className="font-medium tabular-nums">
              {discrepancy.differenceValue !== null ? format.number(discrepancy.differenceValue, { style: "currency", currency: discrepancy.currency ?? "EUR" }) : "—"}
            </p>
          </div>
          <div>
            <p className="text-muted-foreground">{t("discrepancyDetail.currency")}</p>
            <p className="font-medium">{discrepancy.currency ?? "—"}</p>
          </div>
        </ResponsiveGrid>
      </Section>

      <Section title={t("discrepancyDetail.references")} bordered>
        <ResponsiveGrid cols="1-2-4">
          <div>
            <p className="text-muted-foreground">{t("discrepancyDetail.job")}</p>
            <p className="font-mono text-xs">
              {discrepancy.jobId ? (
                <Link
                  href={`/admin/reconciliation/jobs/${discrepancy.jobId}`}
                  className="text-primary underline-offset-2 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring rounded-sm"
                >
                  {discrepancy.jobId}
                </Link>
              ) : (
                "—"
              )}
            </p>
          </div>
          <div>
            <p className="text-muted-foreground">{t("discrepancyDetail.payment")}</p>
            <p className="font-mono text-xs">{discrepancy.paymentId ?? "—"}</p>
          </div>
          <div>
            <p className="text-muted-foreground">{t("discrepancyDetail.invoice")}</p>
            <p className="font-mono text-xs">{discrepancy.invoiceId ?? "—"}</p>
          </div>
          <div>
            <p className="text-muted-foreground">{t("discrepancyDetail.payout")}</p>
            <p className="font-mono text-xs">{discrepancy.payoutId ?? "—"}</p>
          </div>
          <div>
            <p className="text-muted-foreground">{t("discrepancyDetail.refund")}</p>
            <p className="font-mono text-xs">{discrepancy.refundId ?? "—"}</p>
          </div>
          <div>
            <p className="text-muted-foreground">{t("discrepancyDetail.creditNote")}</p>
            <p className="font-mono text-xs">{discrepancy.creditNoteId ?? "—"}</p>
          </div>
          <div>
            <p className="text-muted-foreground">{t("discrepancyDetail.entityId")}</p>
            <p className="font-mono text-xs">{discrepancy.entityId ?? "—"}</p>
          </div>
        </ResponsiveGrid>
      </Section>

      <Section title={t("discrepancyDetail.timeline")} bordered>
        <ResponsiveGrid cols="1-2-4">
          <div>
            <p className="text-muted-foreground">{t("discrepancyDetail.detectedAt")}</p>
            <p className="font-medium">{dateTime(discrepancy.detectedAt)}</p>
          </div>
          <div>
            <p className="text-muted-foreground">{t("discrepancyDetail.lastUpdated")}</p>
            <p className="font-medium">{dateTime(discrepancy.updatedAt)}</p>
          </div>
          <div>
            <p className="text-muted-foreground">{t("discrepancyDetail.detectedByRun")}</p>
            <Link
              href={`/admin/reconciliation/runs/${discrepancy.detectedByRunId}`}
              className="font-mono text-xs text-primary underline-offset-2 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring rounded-sm"
            >
              {discrepancy.detectedByRunId.slice(0, 8)}…
            </Link>
          </div>
          <div>
            <p className="text-muted-foreground">{t("discrepancyDetail.lastSeenInRun")}</p>
            <Link
              href={`/admin/reconciliation/runs/${discrepancy.lastSeenRunId}`}
              className="font-mono text-xs text-primary underline-offset-2 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring rounded-sm"
            >
              {discrepancy.lastSeenRunId.slice(0, 8)}…
            </Link>
          </div>
        </ResponsiveGrid>
      </Section>

      <Section title={t("discrepancyDetail.resolution")} bordered className={discrepancy.resolution ? "bg-success-muted/20" : undefined}>
        {discrepancy.resolution ? (
          <ResponsiveGrid cols="1-2-lg">
            <div>
              <p className="text-muted-foreground">{t("discrepancyDetail.resolvedBy")}</p>
              <p className="font-mono text-xs">{discrepancy.resolution.resolvedByUserId}</p>
            </div>
            <div>
              <p className="text-muted-foreground">{t("discrepancyDetail.resolvedAt")}</p>
              <p className="font-medium">{dateTime(discrepancy.resolution.resolvedAt)}</p>
            </div>
            <div className="sm:col-span-2">
              <p className="text-muted-foreground">{t("discrepancyDetail.reason")}</p>
              <p className="whitespace-pre-wrap text-sm font-medium">{discrepancy.resolution.reason}</p>
            </div>
          </ResponsiveGrid>
        ) : (
          <>
            <p className="text-sm text-muted-foreground">{t("discrepancyDetail.notResolved")}</p>
            <div>
              <ResolveDiscrepancyDialog discrepancyId={discrepancy.id} />
            </div>
          </>
        )}
      </Section>

      {snapshot && (
        <Section title={t("discrepancyDetail.snapshot")}>
          <p className="text-sm text-muted-foreground">
            {t("discrepancyDetail.snapshotSummary", {
              jobId: snapshot.jobId,
              status: snapshot.jobStatus,
              total: format.number(snapshot.quoteTotalAmount, { style: "currency", currency: snapshot.quoteCurrency }),
            })}
            {" "}
            <Link
              href={`/admin/reconciliation/jobs/${snapshot.jobId}`}
              className="text-primary underline-offset-2 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring rounded-sm"
            >
              {t("discrepancyDetail.viewSnapshot")}
            </Link>
          </p>
        </Section>
      )}
    </div>
  );
}
