import { notFound } from "next/navigation";
import Link from "next/link";

import { getFinancialEntitySnapshotAction, getReconciliationDiscrepancyAction } from "../../actions";
import { PageHeader } from "@/components/dashboard/page-header";
import { ResponsiveGrid } from "@/components/layout/responsive-grid";
import { Section } from "@/components/layout/section";
import { formatMoney } from "@/components/dashboard/quote-items-table";
import { SeverityBadge, ResolutionStatusBadge } from "../../_components/badges";
import { ResolveDiscrepancyDialog } from "./resolve-discrepancy-dialog";

export const metadata = { title: "Admin — Discrepancy" };
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

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title={`Discrepancy ${discrepancy.id.slice(0, 8)}…`}
        subtitle={discrepancy.category.replaceAll("_", " ").toLowerCase()}
        breadcrumbs={[
          { label: "Reconciliation", href: "/admin/reconciliation" },
          { label: "Discrepancies", href: "/admin/reconciliation/discrepancies" },
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

      <Section title="Identity" bordered>
        <ResponsiveGrid cols="1-2-lg">
          <div>
            <p className="text-muted-foreground">Entity type</p>
            <p className="font-medium">{discrepancy.entityType}</p>
          </div>
          <div>
            <p className="text-muted-foreground">Fingerprint</p>
            <p className="font-mono text-xs">{discrepancy.fingerprint}</p>
          </div>
        </ResponsiveGrid>
      </Section>

      <Section title="Financial information" bordered>
        <ResponsiveGrid cols="1-2-4">
          <div>
            <p className="text-muted-foreground">Internal amount</p>
            <p className="font-medium tabular-nums">
              {discrepancy.expectedValue !== null ? formatMoney(discrepancy.expectedValue, discrepancy.currency ?? "EUR") : "—"}
            </p>
          </div>
          <div>
            <p className="text-muted-foreground">Provider/actual amount</p>
            <p className="font-medium tabular-nums">
              {discrepancy.actualValue !== null ? formatMoney(discrepancy.actualValue, discrepancy.currency ?? "EUR") : "—"}
            </p>
          </div>
          <div>
            <p className="text-muted-foreground">Difference</p>
            <p className="font-medium tabular-nums">
              {discrepancy.differenceValue !== null ? formatMoney(discrepancy.differenceValue, discrepancy.currency ?? "EUR") : "—"}
            </p>
          </div>
          <div>
            <p className="text-muted-foreground">Currency</p>
            <p className="font-medium">{discrepancy.currency ?? "—"}</p>
          </div>
        </ResponsiveGrid>
      </Section>

      <Section title="References" bordered>
        <ResponsiveGrid cols="1-2-4">
          <div>
            <p className="text-muted-foreground">Job</p>
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
            <p className="text-muted-foreground">Payment</p>
            <p className="font-mono text-xs">{discrepancy.paymentId ?? "—"}</p>
          </div>
          <div>
            <p className="text-muted-foreground">Invoice</p>
            <p className="font-mono text-xs">{discrepancy.invoiceId ?? "—"}</p>
          </div>
          <div>
            <p className="text-muted-foreground">Payout</p>
            <p className="font-mono text-xs">{discrepancy.payoutId ?? "—"}</p>
          </div>
          <div>
            <p className="text-muted-foreground">Refund</p>
            <p className="font-mono text-xs">{discrepancy.refundId ?? "—"}</p>
          </div>
          <div>
            <p className="text-muted-foreground">Credit note</p>
            <p className="font-mono text-xs">{discrepancy.creditNoteId ?? "—"}</p>
          </div>
          <div>
            <p className="text-muted-foreground">Entity id</p>
            <p className="font-mono text-xs">{discrepancy.entityId ?? "—"}</p>
          </div>
        </ResponsiveGrid>
      </Section>

      <Section title="Timeline" bordered>
        <ResponsiveGrid cols="1-2-4">
          <div>
            <p className="text-muted-foreground">Detected at</p>
            <p className="font-medium">{new Date(discrepancy.detectedAt).toLocaleString()}</p>
          </div>
          <div>
            <p className="text-muted-foreground">Last updated</p>
            <p className="font-medium">{new Date(discrepancy.updatedAt).toLocaleString()}</p>
          </div>
          <div>
            <p className="text-muted-foreground">Detected by run</p>
            <Link
              href={`/admin/reconciliation/runs/${discrepancy.detectedByRunId}`}
              className="font-mono text-xs text-primary underline-offset-2 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring rounded-sm"
            >
              {discrepancy.detectedByRunId.slice(0, 8)}…
            </Link>
          </div>
          <div>
            <p className="text-muted-foreground">Last seen in run</p>
            <Link
              href={`/admin/reconciliation/runs/${discrepancy.lastSeenRunId}`}
              className="font-mono text-xs text-primary underline-offset-2 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring rounded-sm"
            >
              {discrepancy.lastSeenRunId.slice(0, 8)}…
            </Link>
          </div>
        </ResponsiveGrid>
      </Section>

      <Section title="Resolution" bordered className={discrepancy.resolution ? "bg-success-muted/20" : undefined}>
        {discrepancy.resolution ? (
          <ResponsiveGrid cols="1-2-lg">
            <div>
              <p className="text-muted-foreground">Resolved by</p>
              <p className="font-mono text-xs">{discrepancy.resolution.resolvedByUserId}</p>
            </div>
            <div>
              <p className="text-muted-foreground">Resolved at</p>
              <p className="font-medium">{new Date(discrepancy.resolution.resolvedAt).toLocaleString()}</p>
            </div>
            <div className="sm:col-span-2">
              <p className="text-muted-foreground">Reason</p>
              <p className="whitespace-pre-wrap text-sm font-medium">{discrepancy.resolution.reason}</p>
            </div>
          </ResponsiveGrid>
        ) : (
          <>
            <p className="text-sm text-muted-foreground">This discrepancy has not been resolved yet.</p>
            <div>
              <ResolveDiscrepancyDialog discrepancyId={discrepancy.id} />
            </div>
          </>
        )}
      </Section>

      {snapshot && (
        <Section title="Job financial snapshot">
          <p className="text-sm text-muted-foreground">
            Job {snapshot.jobId} — status {snapshot.jobStatus}, quote total {formatMoney(snapshot.quoteTotalAmount, snapshot.quoteCurrency)}.
            {" "}
            <Link
              href={`/admin/reconciliation/jobs/${snapshot.jobId}`}
              className="text-primary underline-offset-2 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring rounded-sm"
            >
              View full snapshot
            </Link>
          </p>
        </Section>
      )}
    </div>
  );
}
