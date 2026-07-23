import Link from "next/link";
import { notFound } from "next/navigation";

import { NotFoundError } from "@/domain/errors/domain-error";
import { requireAuth } from "@/infrastructure/auth/rbac";
import { makeGetServiceRequestForProfessionalUseCase } from "@/application/use-cases/quotes/compose";

export const metadata = { title: "Service request" };

/**
 * Professional-facing detail page for a single eligible ServiceRequest.
 * GetServiceRequestForProfessionalUseCase never trusts the `id` route
 * param alone — a request that exists but that this professional isn't
 * eligible to respond to (wrong category, outside their radius, not
 * PUBLISHED, or their own request) surfaces as a plain 404, exactly like
 * an id that doesn't exist at all — see quote-eligibility.ts.
 */
export default async function ProfessionalServiceRequestDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const user = await requireAuth();

  let request;
  try {
    request = await makeGetServiceRequestForProfessionalUseCase().execute(user.id, id);
  } catch (error) {
    if (error instanceof NotFoundError) notFound();
    throw error;
  }

  return (
    <div className="mx-auto flex w-full max-w-2xl flex-col gap-8 px-4 py-10">
      <Link href="/dashboard/professional/requests" className="text-sm text-foreground/70 hover:underline">
        ← Back to available requests
      </Link>

      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold">{request.title}</h1>
          <p className="mt-1 text-sm text-foreground/70">{request.categoryName}</p>
        </div>
        <span className="rounded-full bg-black/5 px-3 py-1 text-xs font-medium text-foreground/70">
          {request.distanceKm} km away
        </span>
      </div>

      <section className="flex flex-col gap-2">
        <h2 className="text-lg font-medium">Description</h2>
        <p className="whitespace-pre-line text-sm text-foreground/80">{request.description}</p>
      </section>

      {/* Only coarse location (city/province) is ever shown here — the
          customer's exact address is never exposed to a professional who
          hasn't been accepted for the job (see ServiceRequestDiscoveryRepository). */}
      <section className="grid grid-cols-2 gap-4 rounded-md border border-border p-4 text-sm">
        <div>
          <p className="text-foreground/60">Location</p>
          <p className="font-medium">
            {request.city}
            {request.province ? `, ${request.province}` : ""}
          </p>
        </div>
        <div>
          <p className="text-foreground/60">Urgency</p>
          <p className="font-medium">{request.urgency}</p>
        </div>
        <div>
          <p className="text-foreground/60">Posted</p>
          <p className="font-medium">{request.createdAt.toLocaleDateString()}</p>
        </div>
      </section>

      <section className="flex flex-wrap gap-3 border-t border-border pt-6">
        <Link
          href={`/dashboard/professional/requests/${request.id}/quote`}
          className="inline-flex h-10 items-center justify-center rounded-md bg-primary px-4 text-sm font-medium text-primary-foreground transition-colors hover:opacity-90"
        >
          Submit a quote
        </Link>
      </section>
    </div>
  );
}
