import { Building2 } from "lucide-react";
import { getTranslations } from "next-intl/server";

import { createCompanyFormAction } from "@/app/(dashboard)/dashboard/company/actions";
import { makeListMyCompaniesUseCase } from "@/application/use-cases/company/compose";
import { requireAuth } from "@/infrastructure/auth/rbac";
import { PageHeader } from "@/components/dashboard/page-header";
import { CompanyCard } from "@/components/dashboard/cards/company-card";
import { PageContainer } from "@/components/layout/page-container";
import { EmptyState } from "@/components/ui/empty-state";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { FormActions } from "@/components/forms/form-actions";
import { FormSection } from "@/components/forms/form-section";

export async function generateMetadata() {
  const t = await getTranslations("company.index");
  return { title: t("metaTitle") };
}

/**
 * Module 18 — Company Professional: company context selector (Section 17
 * of the module brief) — URL-based company context. A user may belong to
 * more than one company; this lists every one they're an active member of
 * and lets them create a new one. Company-scoped pages then live under
 * `/dashboard/company/[companyId]/...`, with every server-side action
 * re-deriving the caller's membership/role from the session — never
 * trusting `companyId` alone for authorization.
 */
export default async function CompanyIndexPage() {
  const user = await requireAuth();
  const companies = await makeListMyCompaniesUseCase().execute(user.id);
  const t = await getTranslations("company.index");

  return (
    <PageContainer>
      <PageHeader
        title={t("title")}
        subtitle={t("subtitle")}
      />

      {companies.length === 0 ? (
        <EmptyState
          icon={Building2}
          title={t("emptyTitle")}
          description={t("emptyDescription")}
        />
      ) : (
        <ul className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          {companies.map((company) => (
            <li key={company.id}>
              <CompanyCard
                href={`/dashboard/company/${company.id}/profile`}
                name={company.tradeName ?? company.legalName}
                status={company.status}
                actionLabel={t("manage")}
              />
            </li>
          ))}
        </ul>
      )}

      <FormSection title={t("createTitle")}>
        <form action={createCompanyFormAction} className="flex flex-col gap-4">
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="legalName">{t("legalNameRequired")}</Label>
            <Input id="legalName" name="legalName" required minLength={2} maxLength={200} />
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="tradeName">{t("tradeName")}</Label>
            <Input id="tradeName" name="tradeName" maxLength={200} />
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="taxId">{t("taxIdRequired")}</Label>
            <Input id="taxId" name="taxId" required maxLength={50} />
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="description">{t("description")}</Label>
            <Textarea id="description" name="description" rows={3} maxLength={5000} />
          </div>
          <FormActions>
            <Button type="submit" className="sm:w-fit">
              {t("submit")}
            </Button>
          </FormActions>
        </form>
      </FormSection>
    </PageContainer>
  );
}
