import Link from "next/link";

import { requireAuth } from "@/infrastructure/auth/rbac";
import { makeGetAvailableServiceRequestsForProfessionalUseCase } from "@/application/use-cases/quotes/compose";
import { PageHeader } from "@/components/dashboard/page-header";

export const metadata = { title: "Available requests" };

/**
 * Professional-facing list of PUBLISHED service requests the *authenticated*
 * professional is eligible to respond to (matching category + within their
 * own service radius — see domain/services/quote-eligibility.ts). Never
 * trusts a client-supplied professionalId; ownership/eligibility are always
 * derived from the session's own ProfessionalProfile.
 */
export default async function AvailableServiceRequestsPage() {
  const user = await requireAuth();
  const requests = await makeGetAvailableServiceRequestsForProfessionalUseCase().execute(user.id);

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="Available requests"
        subtitle="Service requests from customers that match your categories and service radius. Review one and create a quote to respond."
      />

      {requests.length === 0 ? (
        <p className="rounded-md border border-dashed border-border p-6 text-center text-sm text-foreground/70">
          No matching service requests right now. Make sure your professional profile is active, with
          service categories and a service radius configured.
        </p>
      ) : (
        <ul className="flex flex-col gap-3">
          {requests.map((request) => (
            <li key={request.id}>
              <Link
                href={`/dashboard/professional/requests/${request.id}`}
                className="flex flex-col gap-2 rounded-md border border-border p-4 hover:bg-black/5"
              >
                <div className="flex items-center justify-between gap-4">
                  <h2 className="font-medium">{request.title}</h2>
                  <span className="rounded-full bg-black/5 px-3 py-1 text-xs font-medium text-foreground/70">
                    {request.distanceKm} km away
                  </span>
                </div>
                <p className="text-sm text-foreground/70">{request.categoryName}</p>
                <p className="text-sm text-foreground/70">
                  {request.city}
                  {request.province ? `, ${request.province}` : ""}
                </p>
                <p className="text-xs text-foreground/50">
                  Posted {request.createdAt.toLocaleDateString()}
                </p>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
