import { notFound, redirect } from "next/navigation";

import { NotFoundError } from "@/domain/errors/domain-error";
import { requireAuth } from "@/infrastructure/auth/rbac";
import { PrismaServiceCategoryRepository } from "@/infrastructure/database/prisma/repositories/prisma-service-category-repository";
import { makeGetServiceRequestUseCase } from "@/application/use-cases/service-request/compose";
import { PageHeader } from "@/components/dashboard/page-header";
import { Section } from "@/components/layout/section";
import { ServiceRequestForm } from "../../service-request-form";
import { ServiceRequestPhotoManager } from "../service-request-photo-manager";

export const metadata = { title: "Edit service request" };

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

  const categories = await new PrismaServiceCategoryRepository().listActive();

  return (
    <div className="flex flex-col gap-8">
      <PageHeader
        title="Edit service request"
        subtitle="You can edit this request while it's still open."
        breadcrumbs={[
          { label: "My requests", href: "/requests" },
          { label: request.title, href: `/requests/${request.id}` },
          { label: "Edit" },
        ]}
      />

      <ServiceRequestForm mode="edit" categories={categories} request={request} />

      <Section title="Photos" divider>
        <ServiceRequestPhotoManager requestId={request.id} photos={request.photos} editable />
      </Section>
    </div>
  );
}
