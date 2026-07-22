import Link from "next/link";

import { requireAuth } from "@/infrastructure/auth/rbac";
import { makeGetCustomerServiceRequestsUseCase } from "@/application/use-cases/service-request/compose";
import { RequestStatusBadge } from "./request-status-badge";

export const metadata = { title: "My requests" };

export default async function ServiceRequestsPage() {
  const user = await requireAuth();
  // Never trust a client-supplied id here — requests are always looked up
  // for the authenticated session's own userId, exactly like the
  // Professional dashboard looks up "my professional profile".
  const requests = await makeGetCustomerServiceRequestsUseCase().execute(user.id);

  return (
    <div className="mx-auto flex w-full max-w-3xl flex-col gap-6 px-4 py-10">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold">My requests</h1>
          <p className="mt-1 text-sm text-foreground/70">
            Service requests you&apos;ve posted for professionals to quote on.
          </p>
        </div>
        <Link
          href="/requests/new"
          className="inline-flex h-10 items-center justify-center rounded-md bg-primary px-4 text-sm font-medium text-primary-foreground transition-colors hover:opacity-90"
        >
          New request
        </Link>
      </div>

      {requests.length === 0 ? (
        <p className="rounded-md border border-dashed border-border p-6 text-center text-sm text-foreground/70">
          You haven&apos;t posted any service requests yet.
        </p>
      ) : (
        <ul className="flex flex-col gap-3">
          {requests.map((request) => (
            <li key={request.id}>
              <Link
                href={`/requests/${request.id}`}
                className="flex flex-col gap-2 rounded-md border border-border p-4 hover:bg-black/5"
              >
                <div className="flex items-center justify-between gap-4">
                  <h2 className="font-medium">{request.title}</h2>
                  <RequestStatusBadge status={request.status} />
                </div>
                <p className="text-sm text-foreground/70">{request.categoryName}</p>
                <p className="text-sm text-foreground/70">{request.location.city}</p>
                <p className="text-xs text-foreground/50">
                  Posted {request.createdAt.toLocaleDateString()} — updated{" "}
                  {request.updatedAt.toLocaleDateString()}
                </p>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
