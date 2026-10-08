import { getTranslations } from "next-intl/server";

import { requireAuth } from "@/infrastructure/auth/rbac";
import { PageHeader } from "@/components/dashboard/page-header";
import { makeListLeadRequestCategoriesUseCase } from "@/application/use-cases/lead-request/compose";
import { localizeCategoryName } from "@/presentation/i18n/service-categories";
import { LeadRequestForm } from "./lead-request-form";

export async function generateMetadata() {
  const t = await getTranslations("customer.requests.leadForm");
  return { title: t("title") };
}

/**
 * Module 142 — customer LEAD_V1 "Request a service". The category list is the
 * backend-authoritative one (Module 132 pilot configuration, via the use case):
 * this page only localizes names for display and never decides support itself.
 */
export default async function NewLeadRequestPage() {
  await requireAuth();

  const [options, t, tList, tServices] = await Promise.all([
    makeListLeadRequestCategoriesUseCase().execute(),
    getTranslations("customer.requests.leadForm"),
    getTranslations("customer.requests"),
    getTranslations("services"),
  ]);
  const categories = options.map((category) => ({ id: category.id, name: localizeCategoryName(tServices, category) }));

  return (
    <div className="flex flex-col gap-8">
      <PageHeader
        title={t("title")}
        subtitle={t("subtitle")}
        breadcrumbs={[{ label: tList("list.title"), href: "/requests" }, { label: t("title") }]}
      />
      <LeadRequestForm categories={categories} />
    </div>
  );
}
