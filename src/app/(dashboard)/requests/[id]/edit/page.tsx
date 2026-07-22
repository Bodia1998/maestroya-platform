import Link from "next/link";
import { notFound, redirect } from "next/navigation";

import { NotFoundError } from "@/domain/errors/domain-error";
import { requireAuth } from "@/infrastructure/auth/rbac";
import { PrismaServiceCategoryRepository } from "@/infrastructure/database/prisma/repositories/prisma-service-category-repository";
import { makeGetServiceRequestUseCase } from "@/application/use-cases/service-request/compose";
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
    <div className="mx-auto flex w-full max-w-2xl flex-col gap-8 px-4 py-10">
      <Link href={`/requests/${request.id}`} className="text-sm text-foreground/70 hover:underline">
        ← Back to request
      </Link>

      <div>
        <h1 className="text-2xl font-semibold">Edit service request</h1>
        <p className="mt-1 text-sm text-foreground/70">
          You can edit this request while it&apos;s still open.
        </p>
      </div>

      <ServiceRequestForm mode="edit" categories={categories} request={request} />

      <section className="flex flex-col gap-3 border-t border-border pt-6">
        <h2 className="text-lg font-medium">Photos</h2>
        <ServiceRequestPhotoManager requestId={request.id} photos={request.photos} editable />
      </section>
    </div>
  );
}
