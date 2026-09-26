import { FileText } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { getFormatter, getTranslations } from "next-intl/server";

import { makeListInvoicesForProfessionalUseCase } from "@/application/use-cases/invoicing/compose";
import { requireAuth } from "@/infrastructure/auth/rbac";
import { PageHeader } from "@/components/dashboard/page-header";
import { StatusBadge } from "@/components/dashboard/status-badge";
import { EmptyState } from "@/components/ui/empty-state";
import { PageContainer } from "@/components/layout/page-container";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("professional.invoices.list");
  return { title: t("metaTitle") };
}

/**
 * Module 99 — Self-Billing Authorization Entry Point & Financial Document
 * Access.
 *
 * The professional-facing side of the document-access gap: self-billed
 * invoices (Module 79/85) have been generated and issued automatically
 * once a professional holds an ACTIVE `SelfBillingAuthorization` (see
 * `/dashboard/professional/self-billing`), but nothing previously let the
 * professional themselves see them. Solo-professional scope only — same
 * explicit limitation `ListJobsForProfessionalUseCase` already documents
 * ("company-owned jobs are out of scope for this list"); a company
 * member sees their company's invoices at
 * `/dashboard/company/[companyId]/self-billing` instead.
 */
export default async function ProfessionalInvoicesPage() {
  const user = await requireAuth();
  const [invoices, t, format] = await Promise.all([
    makeListInvoicesForProfessionalUseCase().execute(user.id),
    getTranslations("professional.invoices.list"),
    getFormatter(),
  ]);

  return (
    <PageContainer maxWidth="3xl" gap="sm">
      <PageHeader title={t("title")} subtitle={t("subtitle")} />

      {invoices.length === 0 ? (
        <EmptyState
          icon={FileText}
          title={t("emptyTitle")}
          description={t("emptyDescription")}
        />
      ) : (
        <ul className="flex flex-col gap-3">
          {invoices.map((invoice) => (
            <li key={invoice.id}>
              <Link
                href={`/dashboard/professional/invoices/${invoice.id}`}
                className="flex items-center justify-between gap-4 rounded-md border border-border p-4 hover:bg-black/5"
              >
                <div className="flex flex-col gap-1">
                  <span className="font-medium">{invoice.invoiceNumber ?? t("notYetIssued")}</span>
                  <span className="text-xs text-foreground/60">{format.dateTime(invoice.invoiceDate, { dateStyle: "medium" })}</span>
                </div>
                <div className="flex items-center gap-3">
                  <span className="text-sm font-medium">{format.number(invoice.totalAmount, { style: "currency", currency: invoice.currency })}</span>
                  <StatusBadge status={invoice.status} />
                </div>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </PageContainer>
  );
}
