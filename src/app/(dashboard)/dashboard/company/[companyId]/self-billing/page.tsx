import { notFound } from "next/navigation";
import Link from "next/link";
import { getFormatter, getTranslations } from "next-intl/server";

import { makeGetCompanyForMemberUseCase } from "@/application/use-cases/company/compose";
import {
  makeGetMySelfBillingAuthorizationUseCase,
  makeListInvoicesForCompanyUseCase,
} from "@/application/use-cases/invoicing/compose";
import { NotFoundError, UnauthorizedError } from "@/domain/errors/domain-error";
import { requireAuth } from "@/infrastructure/auth/rbac";
import { PageHeader } from "@/components/dashboard/page-header";
import { PageContainer } from "@/components/layout/page-container";
import { Section } from "@/components/layout/section";
import { StatusBadge } from "@/components/dashboard/status-badge";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { CompanyTabNav } from "../company-tab-nav";
import { grantCompanySelfBillingAuthorizationFormAction, revokeCompanySelfBillingAuthorizationFormAction } from "./actions";

export async function generateMetadata() {
  const t = await getTranslations("company.selfBilling");
  return { title: t("metaTitle") };
}

/**
 * Module 99 — Self-Billing Authorization Entry Point & Financial Document
 * Access.
 *
 * Company-side companion to dashboard/professional/self-billing/page.tsx —
 * same minimal status/grant/revoke shape (Workstream D), combined here with
 * a read-only list of the company's own self-billed invoices (Workstream C)
 * to avoid a second new page/nav entry for what the decision document
 * scoped as one narrow settings surface. Granting/revoking is OWNER/ADMIN
 * only (`canManageCompanyProfile` — a legal/financial commitment); viewing
 * invoices is OWNER/ADMIN/MANAGER (`canActOnBehalfOfCompanyJob`), both
 * enforced inside the composed use cases, not here.
 */
export default async function CompanySelfBillingPage({ params }: { params: Promise<{ companyId: string }> }) {
  const { companyId } = await params;
  const user = await requireAuth();

  try {
    await makeGetCompanyForMemberUseCase().execute(user.id, companyId);
  } catch (error) {
    if (error instanceof NotFoundError) notFound();
    throw error;
  }

  let authorization = null;
  let canManage = true;
  try {
    authorization = await makeGetMySelfBillingAuthorizationUseCase().execute({ userId: user.id, companyId });
  } catch (error) {
    if (error instanceof UnauthorizedError) {
      canManage = false;
    } else if (!(error instanceof NotFoundError)) {
      throw error;
    }
  }

  const companyInvoices = await makeListInvoicesForCompanyUseCase().execute(user.id, companyId).catch(() => []);

  const isActive = authorization?.status === "ACTIVE";
  const t = await getTranslations("company.selfBilling");
  const format = await getFormatter();

  return (
    <PageContainer gap="sm">
      <PageHeader title={t("title")} subtitle={t("subtitle")} />
      <CompanyTabNav companyId={companyId} active="self-billing" />

      {!canManage ? (
        <Alert variant="info" title={t("ownerOnlyTitle")}>
          <p>{t("ownerOnlyBody")}</p>
        </Alert>
      ) : (
        <Section title={t("sectionTitle")} bordered gap="sm">
          <div className="flex items-center gap-3">
            {authorization ? (
              <StatusBadge status={authorization.status} />
            ) : (
              <span className="rounded-full bg-black/5 px-2.5 py-0.5 text-xs font-medium text-foreground/70">
                {t("notAuthorized")}
              </span>
            )}
          </div>

          {isActive ? (
            <>
              <p className="text-sm text-foreground/80">
                {/* The Spanish legal term stays in Spanish in every locale (conventions §8). */}
                {t("activeBody", { legalTerm: "facturación por el destinatario" })}
              </p>
              <form action={revokeCompanySelfBillingAuthorizationFormAction.bind(null, companyId)}>
                <Button type="submit" variant="outline">
                  {t("revoke")}
                </Button>
              </form>
            </>
          ) : (
            <>
              <p className="text-sm text-foreground/80">
                {t("inactiveBody")}
              </p>
              <form action={grantCompanySelfBillingAuthorizationFormAction.bind(null, companyId)}>
                <Button type="submit">{t("grant")}</Button>
              </form>
            </>
          )}
        </Section>
      )}

      <Section title={t("invoicesTitle")} bordered gap="sm">
        {companyInvoices.length === 0 ? (
          <p className="text-sm text-foreground/70">{t("noInvoices")}</p>
        ) : (
          <ul className="flex flex-col gap-2">
            {companyInvoices.map((invoice) => (
              <li key={invoice.id}>
                <Link
                  href={`/dashboard/professional/invoices/${invoice.id}`}
                  className="flex items-center justify-between gap-4 rounded-md border border-border p-3 text-sm hover:bg-black/5"
                >
                  <span>{invoice.invoiceNumber ?? t("notYetIssued")}</span>
                  <span className="flex items-center gap-3">
                    <span className="font-medium">{format.number(invoice.totalAmount, { style: "currency", currency: invoice.currency })}</span>
                    <StatusBadge status={invoice.status} />
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </Section>
    </PageContainer>
  );
}
