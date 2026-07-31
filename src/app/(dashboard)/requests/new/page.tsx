import { requireAuth } from "@/infrastructure/auth/rbac";
import { PrismaServiceCategoryRepository } from "@/infrastructure/database/prisma/repositories/prisma-service-category-repository";
import { ServiceRequestForm } from "../service-request-form";

export const metadata = { title: "New service request" };

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
  const categories = await new PrismaServiceCategoryRepository().listActive();

  return (
    <div className="mx-auto flex w-full max-w-2xl flex-col gap-8 px-4 py-10">
      <div>
        <h1 className="text-2xl font-semibold">New service request</h1>
        <p className="mt-1 text-sm text-foreground/70">
          Describe the job you need done. It will be posted immediately for professionals to
          quote on.
        </p>
      </div>

      <ServiceRequestForm
        mode="create"
        categories={categories}
        request={null}
        prefill={{ categoryId, city }}
      />
    </div>
  );
}
