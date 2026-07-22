import Link from "next/link";
import { notFound } from "next/navigation";

import { NotFoundError } from "@/domain/errors/domain-error";
import { requireAuth } from "@/infrastructure/auth/rbac";
import { makeGetServiceRequestUseCase } from "@/application/use-cases/service-request/compose";
import { RequestStatusBadge } from "../request-status-badge";
import { CancelServiceRequestDialog } from "./cancel-service-request-dialog";
import { ServiceRequestPhotoManager } from "./service-request-photo-manager";

export const metadata = { title: "Service request" };

/**
 * Customer-facing detail page for one of *their own* service requests only
 * — GetServiceRequestUseCase never trusts the `id` route param as proof of
 * ownership, it re-checks against the signed-in session's own
 * CustomerProfile. A request belonging to someone else surfaces as a plain
 * 404, identical to an id that doesn't exist at all, so this page can never
 * be used to probe for another customer's requests.
 */
export default async function ServiceRequestDetailPage({
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

  const isEditable = request.status === "PUBLISHED";

  return (
    <div className="mx-auto flex w-full max-w-2xl flex-col gap-8 px-4 py-10">
      <Link href="/requests" className="text-sm text-foreground/70 hover:underline">
        ← Back to my requests
      </Link>

      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold">{request.title}</h1>
          <p className="mt-1 text-sm text-foreground/70">{request.categoryName}</p>
        </div>
        <RequestStatusBadge status={request.status} />
      </div>

      <section className="flex flex-col gap-2">
        <h2 className="text-lg font-medium">Description</h2>
        <p className="whitespace-pre-line text-sm text-foreground/80">{request.description}</p>
      </section>

      <section className="grid grid-cols-2 gap-4 rounded-md border border-border p-4 text-sm">
        <div>
          <p className="text-foreground/60">Location</p>
          <p className="font-medium">
            {request.location.line1}
            {request.location.line2 ? `, ${request.location.line2}` : ""}
          </p>
          <p className="text-foreground/70">
            {request.location.city}
            {request.location.province ? `, ${request.location.province}` : ""}{" "}
            {request.location.postalCode}
          </p>
          <p className="text-foreground/70">{request.location.country}</p>
        </div>
        <div>
          <p className="text-foreground/60">Urgency</p>
          <p className="font-medium">{request.urgency}</p>
        </div>
        {(request.budgetMin !== null || request.budgetMax !== null) && (
          <div>
            <p className="text-foreground/60">Budget</p>
            <p className="font-medium">
              {request.budgetMin !== null ? `€${request.budgetMin.toFixed(2)}` : "—"}
              {" – "}
              {request.budgetMax !== null ? `€${request.budgetMax.toFixed(2)}` : "—"}
            </p>
          </div>
        )}
        <div>
          <p className="text-foreground/60">Posted</p>
          <p className="font-medium">{request.createdAt.toLocaleString()}</p>
        </div>
        <div>
          <p className="text-foreground/60">Last updated</p>
          <p className="font-medium">{request.updatedAt.toLocaleString()}</p>
        </div>
      </section>

      <section className="flex flex-col gap-3">
        <h2 className="text-lg font-medium">Photos</h2>
        <ServiceRequestPhotoManager
          requestId={request.id}
          photos={request.photos}
          editable={isEditable}
        />
      </section>

      {isEditable && (
        <section className="flex flex-wrap gap-3 border-t border-border pt-6">
          <Link
            href={`/requests/${request.id}/edit`}
            className="inline-flex h-10 items-center justify-center rounded-md border border-border bg-transparent px-4 text-sm font-medium hover:bg-black/5"
          >
            Edit request
          </Link>
          <CancelServiceRequestDialog requestId={request.id} />
        </section>
      )}
    </div>
  );
}
