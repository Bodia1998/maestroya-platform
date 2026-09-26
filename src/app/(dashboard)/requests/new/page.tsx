import { getTranslations } from "next-intl/server";

import { requireAuth } from "@/infrastructure/auth/rbac";
import { PrismaServiceCategoryRepository } from "@/infrastructure/database/prisma/repositories/prisma-service-category-repository";
import { PageHeader } from "@/components/dashboard/page-header";
import { localizeCategoryName } from "@/presentation/i18n/service-categories";
import { ServiceRequestForm } from "../service-request-form";

export async function generateMetadata() {
  const t = await getTranslations("customer.requests");
  return { title: t("new.title") };
}

/**
 * `categoryId`/`city` are optional prefill hints — currently only ever
 * arrive via the "Request this service" link on a public professional
 * profile ((marketing)/professionals/[id]/page.tsx), so a customer who
 * found a professional through search doesn't have to re-select the same
 * category/re-type the same city they were just looking at. Purely a form
 * prefill (see ServiceRequestForm's own doc comment on `prefill`) — the
 * request itself is still a normal, undirected PUBLISHED request, matched
 * to eligible professionals the same way any other request is.
 */
export default async function NewServiceRequestPage({
  searchParams,
}: {
  searchParams: Promise<{ categoryId?: string; city?: string }>;
}) {
  await requireAuth();
  const { categoryId, city } = await searchParams;

  // Static reference data for the category picker — a plain read, not a
  // use case (no business logic), matching how the Professional dashboard
  // reads categories directly (see dashboard/professional/page.tsx).
  const [rawCategories, t, tServices] = await Promise.all([
    new PrismaServiceCategoryRepository().listActive(),
    getTranslations("customer.requests"),
    getTranslations("services"),
  ]);
  const categories = rawCategories.map((category) => ({
    id: category.id,
    name: localizeCategoryName(tServices, category),
  }));

  return (
    <div className="flex flex-col gap-8">
      <PageHeader
        title={t("new.title")}
        subtitle={t("new.subtitle")}
        breadcrumbs={[{ label: t("list.title"), href: "/requests" }, { label: t("list.newRequest") }]}
      />

      <ServiceRequestForm
        mode="create"
        categories={categories}
        request={null}
        prefill={{ categoryId, city }}
      />
    </div>
  );
}
