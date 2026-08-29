import { notFound } from "next/navigation";

import { getFinancialEntitySnapshotAction } from "../../actions";
import { PageHeader } from "@/components/dashboard/page-header";
import { Section } from "@/components/layout/section";
import { ResponsiveGrid } from "@/components/layout/responsive-grid";
import { StatusBadge } from "@/components/dashboard/status-badge";
import { formatMoney } from "@/components/dashboard/quote-items-table";

export const metadata = { title: "Admin — Job financial snapshot" };
export const dynamic = "force-dynamic";

/**
 * Module 81 — Reconciliation Admin Dashboard & Operations: the read-only
 * job financial drill-down a discrepancy links to (spec: "internal
 * payment/job/quote reference where available"). This renders exactly
 * what `GetFinancialEntitySnapshotUseCase` (Module 80) returns — every
 * Payment/Commission/Invoice/Payout/Refund/CreditNote MaestroYa has on
 * record for this job, plus the live tax/commission recomputation used to
 * reconcile it — and nothing this page fetches, computes, or writes
 * itself. Only a payment gateway's own object *reference* (e.g. a Stripe
 * PaymentIntent/Transfer/Refund id) is ever shown, never a secret,
 * API key, or raw authorization header.
 */
export default async function AdminReconciliationJobSnapshotPage({ params }: { params: Promise<{ jobId: string }> }) {
  const { jobId } = await params;
  const result = await getFinancialEntitySnapshotAction({ jobId });
  if (!result.success) {
    notFound();
  }
  const snapshot = result.data;

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="Job financial snapshot"
        subtitle={jobId}
        breadcrumbs={[{ label: "Reconciliation", href: "/admin/reconciliation" }, { label: "Job snapshot" }]}
        actions={<StatusBadge status={snapshot.jobStatus} />}
      />

      <ResponsiveGrid cols="1-2-4" bordered aria-label="Job summary">
        <div>
          <p className="text-muted-foreground">Quote</p>
          <p className="font-mono text-xs">{snapshot.quoteId}</p>
        </div>
        <div>
          <p className="text-muted-foreground">Quote total</p>
          <p className="font-medium">{formatMoney(snapshot.quoteTotalAmount, snapshot.quoteCurrency)}</p>
        </div>
        <div>
          <p className="text-muted-foreground">Customer</p>
          <p className="font-mono text-xs">{snapshot.customerId}</p>
        </div>
        <div>
          <p className="text-muted-foreground">Release approved</p>
          <p className="font-medium">{snapshot.releaseApproved ? "Yes" : "No"}</p>
        </div>
      </ResponsiveGrid>

      <Section title={`Payments (${snapshot.payments.length})`}>
        {snapshot.payments.length === 0 ? (
          <p className="text-sm text-muted-foreground">No payments recorded.</p>
        ) : (
          <ul className="flex flex-col gap-2">
            {snapshot.payments.map((p) => (
              <li key={p.id} className="rounded-md border border-border p-3 text-sm">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <span className="font-medium">{formatMoney(p.amount, p.currency)}</span>
                  <StatusBadge status={p.status} />
                </div>
                <p className="mt-1 text-xs text-muted-foreground">
                  {p.method} · {p.stripePaymentIntentId ?? "no provider reference"}
                </p>
              </li>
            ))}
          </ul>
        )}
      </Section>

      {snapshot.commission && (
        <Section title="Commission">
          <ResponsiveGrid cols="1-2-4" bordered>
            <div>
              <p className="text-muted-foreground">Rate</p>
              <p className="font-medium">{(snapshot.commission.rateBps / 100).toFixed(2)}%</p>
            </div>
            <div>
              <p className="text-muted-foreground">Amount</p>
              <p className="font-medium">{formatMoney(snapshot.commission.amount, snapshot.quoteCurrency)}</p>
            </div>
            <div>
              <p className="text-muted-foreground">Status</p>
              <StatusBadge status={snapshot.commission.status} />
            </div>
            <div>
              <p className="text-muted-foreground">Settled</p>
              <p className="font-medium">{snapshot.commission.settledAt ? new Date(snapshot.commission.settledAt).toLocaleString() : "—"}</p>
            </div>
          </ResponsiveGrid>
        </Section>
      )}

      <Section title={`Invoices (${snapshot.invoices.length})`}>
        {snapshot.invoices.length === 0 ? (
          <p className="text-sm text-muted-foreground">No invoices recorded.</p>
        ) : (
          <ul className="flex flex-col gap-2">
            {snapshot.invoices.map((inv) => (
              <li key={inv.id} className="rounded-md border border-border p-3 text-sm">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <span className="font-medium">{inv.invoiceNumber ?? "(unissued)"} — {formatMoney(inv.totalAmount, inv.currency)}</span>
                  <StatusBadge status={inv.status} />
                </div>
                <p className="mt-1 text-xs text-muted-foreground">
                  VAT {formatMoney(inv.vatAmount, inv.currency)} · Commission {formatMoney(inv.commissionAmount, inv.currency)}
                </p>
              </li>
            ))}
          </ul>
        )}
      </Section>

      {snapshot.payout && (
        <Section title="Payout">
          <ResponsiveGrid cols="1-2-4" bordered>
            <div>
              <p className="text-muted-foreground">Amount</p>
              <p className="font-medium">{formatMoney(snapshot.payout.amount, snapshot.payout.currency)}</p>
            </div>
            <div>
              <p className="text-muted-foreground">Status</p>
              <StatusBadge status={snapshot.payout.status} />
            </div>
            <div>
              <p className="text-muted-foreground">Provider reference</p>
              <p className="font-mono text-xs">{snapshot.payout.stripeTransferId ?? "—"}</p>
            </div>
            <div>
              <p className="text-muted-foreground">Failure reason</p>
              <p className="text-xs">{snapshot.payout.failureReason ?? "—"}</p>
            </div>
          </ResponsiveGrid>
        </Section>
      )}

      <Section title={`Refunds (${snapshot.refunds.length})`}>
        {snapshot.refunds.length === 0 ? (
          <p className="text-sm text-muted-foreground">No refunds recorded.</p>
        ) : (
          <ul className="flex flex-col gap-2">
            {snapshot.refunds.map((r) => (
              <li key={r.id} className="rounded-md border border-border p-3 text-sm">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <span className="font-medium">{formatMoney(r.amount, snapshot.quoteCurrency)}</span>
                  <StatusBadge status={r.status} />
                </div>
                <p className="mt-1 text-xs text-muted-foreground">{r.stripeRefundId ?? "no provider reference"}</p>
              </li>
            ))}
          </ul>
        )}
      </Section>

      <Section title={`Credit notes (${snapshot.creditNotes.length})`}>
        {snapshot.creditNotes.length === 0 ? (
          <p className="text-sm text-muted-foreground">No credit notes recorded.</p>
        ) : (
          <ul className="flex flex-col gap-2">
            {snapshot.creditNotes.map((cn) => (
              <li key={cn.id} className="rounded-md border border-border p-3 text-sm">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <span className="font-medium">{cn.creditNoteNumber ?? "(unissued)"}</span>
                  <StatusBadge status={cn.status} />
                </div>
                <p className="mt-1 text-xs text-muted-foreground">{cn.reason}</p>
              </li>
            ))}
          </ul>
        )}
      </Section>
    </div>
  );
}
