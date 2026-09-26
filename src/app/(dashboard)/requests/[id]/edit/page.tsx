import { notFound, redirect } from "next/navigation";
import { getTranslations } from "next-intl/server";

import { NotFoundError } from "@/domain/errors/domain-error";
import { requireAuth } from "@/infrastructure/auth/rbac";
import { PrismaServiceCategoryRepository } from "@/infrastructure/database/prisma/repositories/prisma-service-category-repository";
import { makeGetServiceRequestUseCase } from "@/application/use-cases/service-request/compose";
import { PageHeader } from "@/components/dashboard/page-header";
import { localizeCategoryName } from "@/presentation/i18n/service-categories";
import { Section } from "@/components/layout/section";
import { ServiceRequestForm } from "../../service-request-form";
import { ServiceRequestPhotoManager } from "../service-request-photo-manager";

export async function generateMetadata() {
  const t = await getTranslations("customer.requests");
  return { title: t("edit.title") };
}

export default async function EditServiceRequestPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const user = await requireAuth();

  let request;
  try {
    request = await makeGetServiceRequestUseCase().execute(user.id, id);
  } catch (error) {
    if (error instanceof NotFoundError) {
      notFound();
    }
    throw error;
  }

  // Only PUBLISHED (the OPEN-equivalent state) requests can be edited —
  // enforced again server-side by UpdateServiceRequestUseCase regardless,
  // but redirecting here avoids showing an edit form that would just
  // reject on submit.
  if (request.status !== "PUBLISHED") {
    redirect(`/requests/${request.id}`);
  }

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
        title={t("edit.title")}
        subtitle={t("edit.subtitle")}
        breadcrumbs={[
          { label: t("list.title"), href: "/requests" },
          { label: request.title, href: `/requests/${request.id}` },
          { label: t("edit.breadcrumb") },
        ]}
      />

      <ServiceRequestForm mode="edit" categories={categories} request={request} />

      <Section title={t("detail.photos")} divider>
        <ServiceRequestPhotoManager requestId={request.id} photos={request.photos} editable />
      </Section>
    </div>
  );
}
