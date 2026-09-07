import { Receipt } from "lucide-react";
import Link from "next/link";

import { makeListInvoicesForCustomerUseCase } from "@/application/use-cases/invoicing/compose";
import { requireAuth } from "@/infrastructure/auth/rbac";
import { PageHeader } from "@/components/dashboard/page-header";
import { StatusBadge } from "@/components/dashboard/status-badge";
import { formatMoney } from "@/components/dashboard/quote-items-table";
import { EmptyState } from "@/components/ui/empty-state";
import { PageContainer } from "@/components/layout/page-container";

export const metadata = { title: "My receipts" };

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
  const receipts = await makeListInvoicesForCustomerUseCase().execute(user.id);

  return (
    <PageContainer maxWidth="3xl" gap="sm">
      <PageHeader title="My receipts" subtitle="Receipts for jobs you've paid for through MaestroYa." />

      {receipts.length === 0 ? (
        <EmptyState
          icon={Receipt}
          title="No receipts yet"
          description="A receipt appears here once a job you've paid for is completed and the payment is released."
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
                  <span className="font-medium">{receipt.invoiceNumber ?? "Not yet issued"}</span>
                  <span className="text-xs text-foreground/60">{receipt.invoiceDate.toLocaleDateString()}</span>
                </div>
                <div className="flex items-center gap-3">
                  <span className="text-sm font-medium">{formatMoney(receipt.totalAmount, receipt.currency)}</span>
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
