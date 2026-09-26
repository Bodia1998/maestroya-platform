import { notFound } from "next/navigation";
import { getFormatter, getTranslations } from "next-intl/server";

import { getFinancialEntitySnapshotAction } from "../../actions";
import { PageHeader } from "@/components/dashboard/page-header";
import { Section } from "@/components/layout/section";
import { ResponsiveGrid } from "@/components/layout/responsive-grid";
import { StatusBadge } from "@/components/dashboard/status-badge";

export async function generateMetadata() {
  const t = await getTranslations("admin");
  return { title: t("common.metaTitle", { page: t("reconciliation.jobSnapshot.title") }) };
}
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
  const t = await getTranslations("admin.reconciliation");
  const tCommon = await getTranslations("admin.common");
  const format = await getFormatter();
  const money = (amount: number, currency: string) => format.number(amount, { style: "currency", currency });

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title={t("jobSnapshot.title")}
        subtitle={jobId}
        breadcrumbs={[{ label: t("title"), href: "/admin/reconciliation" }, { label: t("jobSnapshot.breadcrumb") }]}
        actions={<StatusBadge status={snapshot.jobStatus} />}
      />

      <ResponsiveGrid cols="1-2-4" bordered aria-label={t("jobSnapshot.summary")}>
        <div>
          <p className="text-muted-foreground">{t("jobSnapshot.quote")}</p>
          <p className="font-mono text-xs">{snapshot.quoteId}</p>
        </div>
        <div>
          <p className="text-muted-foreground">{t("jobSnapshot.quoteTotal")}</p>
          <p className="font-medium">{money(snapshot.quoteTotalAmount, snapshot.quoteCurrency)}</p>
        </div>
        <div>
          <p className="text-muted-foreground">{t("jobSnapshot.customer")}</p>
          <p className="font-mono text-xs">{snapshot.customerId}</p>
        </div>
        <div>
          <p className="text-muted-foreground">{t("jobSnapshot.releaseApproved")}</p>
          <p className="font-medium">{snapshot.releaseApproved ? tCommon("yes") : tCommon("no")}</p>
        </div>
      </ResponsiveGrid>

      <Section title={t("jobSnapshot.payments", { count: snapshot.payments.length })}>
        {snapshot.payments.length === 0 ? (
          <p className="text-sm text-muted-foreground">{t("jobSnapshot.noPayments")}</p>
        ) : (
          <ul className="flex flex-col gap-2">
            {snapshot.payments.map((p) => (
              <li key={p.id} className="rounded-md border border-border p-3 text-sm">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <span className="font-medium">{money(p.amount, p.currency)}</span>
                  <StatusBadge status={p.status} />
                </div>
                <p className="mt-1 text-xs text-muted-foreground">
                  {p.method} · {p.stripePaymentIntentId ?? t("jobSnapshot.noProviderReference")}
                </p>
              </li>
            ))}
          </ul>
        )}
      </Section>

      {snapshot.commission && (
        <Section title={t("jobSnapshot.commission")}>
          <ResponsiveGrid cols="1-2-4" bordered>
            <div>
              <p className="text-muted-foreground">{t("jobSnapshot.rate")}</p>
              <p className="font-medium">{format.number(snapshot.commission.rateBps / 10000, { style: "percent", minimumFractionDigits: 2 })}</p>
            </div>
            <div>
              <p className="text-muted-foreground">{t("jobSnapshot.amount")}</p>
              <p className="font-medium">{money(snapshot.commission.amount, snapshot.quoteCurrency)}</p>
            </div>
            <div>
              <p className="text-muted-foreground">{t("jobSnapshot.status")}</p>
              <StatusBadge status={snapshot.commission.status} />
            </div>
            <div>
              <p className="text-muted-foreground">{t("jobSnapshot.settled")}</p>
              <p className="font-medium">{snapshot.commission.settledAt
                  ? format.dateTime(new Date(snapshot.commission.settledAt), { dateStyle: "medium", timeStyle: "short" })
                  : "—"}</p>
            </div>
          </ResponsiveGrid>
        </Section>
      )}

      <Section title={t("jobSnapshot.invoices", { count: snapshot.invoices.length })}>
        {snapshot.invoices.length === 0 ? (
          <p className="text-sm text-muted-foreground">{t("jobSnapshot.noInvoices")}</p>
        ) : (
          <ul className="flex flex-col gap-2">
            {snapshot.invoices.map((inv) => (
              <li key={inv.id} className="rounded-md border border-border p-3 text-sm">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <span className="font-medium">{inv.invoiceNumber ?? t("jobSnapshot.unissued")} — {money(inv.totalAmount, inv.currency)}</span>
                  <StatusBadge status={inv.status} />
                </div>
                <p className="mt-1 text-xs text-muted-foreground">
                  {t("jobSnapshot.invoiceBreakdown", {
                    vat: money(inv.vatAmount, inv.currency),
                    commission: money(inv.commissionAmount, inv.currency),
                  })}
                </p>
              </li>
            ))}
          </ul>
        )}
      </Section>

      {snapshot.payout && (
        <Section title={t("jobSnapshot.payout")}>
          <ResponsiveGrid cols="1-2-4" bordered>
            <div>
              <p className="text-muted-foreground">{t("jobSnapshot.amount")}</p>
              <p className="font-medium">{money(snapshot.payout.amount, snapshot.payout.currency)}</p>
            </div>
            <div>
              <p className="text-muted-foreground">{t("jobSnapshot.status")}</p>
              <StatusBadge status={snapshot.payout.status} />
            </div>
            <div>
              <p className="text-muted-foreground">{t("jobSnapshot.providerReference")}</p>
              <p className="font-mono text-xs">{snapshot.payout.stripeTransferId ?? "—"}</p>
            </div>
            <div>
              <p className="text-muted-foreground">{t("jobSnapshot.failureReason")}</p>
              <p className="text-xs">{snapshot.payout.failureReason ?? "—"}</p>
            </div>
          </ResponsiveGrid>
        </Section>
      )}

      <Section title={t("jobSnapshot.refunds", { count: snapshot.refunds.length })}>
        {snapshot.refunds.length === 0 ? (
          <p className="text-sm text-muted-foreground">{t("jobSnapshot.noRefunds")}</p>
        ) : (
          <ul className="flex flex-col gap-2">
            {snapshot.refunds.map((r) => (
              <li key={r.id} className="rounded-md border border-border p-3 text-sm">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <span className="font-medium">{money(r.amount, snapshot.quoteCurrency)}</span>
                  <StatusBadge status={r.status} />
                </div>
                <p className="mt-1 text-xs text-muted-foreground">{r.stripeRefundId ?? t("jobSnapshot.noProviderReference")}</p>
              </li>
            ))}
          </ul>
        )}
      </Section>

      <Section title={t("jobSnapshot.creditNotes", { count: snapshot.creditNotes.length })}>
        {snapshot.creditNotes.length === 0 ? (
          <p className="text-sm text-muted-foreground">{t("jobSnapshot.noCreditNotes")}</p>
        ) : (
          <ul className="flex flex-col gap-2">
            {snapshot.creditNotes.map((cn) => (
              <li key={cn.id} className="rounded-md border border-border p-3 text-sm">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <span className="font-medium">{cn.creditNoteNumber ?? t("jobSnapshot.unissued")}</span>
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
