import { Receipt } from "lucide-react";
import Link from "next/link";
import { getFormatter, getLocale, getTranslations } from "next-intl/server";

import { makeListInvoicesForCustomerUseCase } from "@/application/use-cases/invoicing/compose";
import { requireAuth } from "@/infrastructure/auth/rbac";
import { PageHeader } from "@/components/dashboard/page-header";
import { StatusBadge } from "@/components/dashboard/status-badge";
import { formatMoney } from "@/components/dashboard/quote-items-table";
import { EmptyState } from "@/components/ui/empty-state";
import { PageContainer } from "@/components/layout/page-container";

export async function generateMetadata() {
  const t = await getTranslations("customer.receipts");
  return { title: t("list.title") };
}

/**
 * Module 99 — Self-Billing Authorization Entry Point & Financial Document
 * Access.
 *
 * The customer-facing side of the document-access gap the cross-module
 * audit identified: `Invoice`/`CUSTOMER_RECEIPT` rows have been generated
 * automatically since Module 85, but until this page nothing ever let the
 * customer who was actually billed see them — only the admin
 * reconciliation dashboard referenced these records at all. Never trusts
 * a client-supplied customer id — `ListInvoicesForCustomerUseCase`
 * resolves the caller's own `CustomerProfile` from the authenticated
 * session (see that use case's own doc comment).
 */
export default async function ReceiptsPage() {
  const user = await requireAuth();
  const [receipts, t, format, locale] = await Promise.all([
    makeListInvoicesForCustomerUseCase().execute(user.id),
    getTranslations("customer.receipts"),
    getFormatter(),
    getLocale(),
  ]);

  return (
    <PageContainer maxWidth="3xl" gap="sm">
      <PageHeader title={t("list.title")} subtitle={t("list.subtitle")} />

      {receipts.length === 0 ? (
        <EmptyState
          icon={Receipt}
          title={t("list.empty.title")}
          description={t("list.empty.description")}
        />
      ) : (
        <ul className="flex flex-col gap-3">
          {receipts.map((receipt) => (
            <li key={receipt.id}>
              <Link
                href={`/receipts/${receipt.id}`}
                className="flex items-center justify-between gap-4 rounded-md border border-border p-4 hover:bg-black/5"
              >
                <div className="flex flex-col gap-1">
                  <span className="font-medium">{receipt.invoiceNumber ?? t("notYetIssued")}</span>
                  <span className="text-xs text-foreground/60">{format.dateTime(receipt.invoiceDate, { dateStyle: "medium" })}</span>
                </div>
                <div className="flex items-center gap-3">
                  <span className="text-sm font-medium">{formatMoney(receipt.totalAmount, receipt.currency, locale)}</span>
                  <StatusBadge status={receipt.status} />
                </div>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </PageContainer>
  );
}
