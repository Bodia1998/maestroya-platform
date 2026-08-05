import Link from "next/link";
import { FileText } from "lucide-react";

import { requireAuth } from "@/infrastructure/auth/rbac";
import { makeGetCustomerServiceRequestsUseCase } from "@/application/use-cases/service-request/compose";
import { PageHeader } from "@/components/dashboard/page-header";
import { ButtonLink } from "@/components/ui/button-link";
import { EmptyState } from "@/components/ui/empty-state";
import { RequestStatusBadge } from "./request-status-badge";

export const metadata = { title: "My requests" };

export default async function ServiceRequestsPage() {
  const user = await requireAuth();
  // Never trust a client-supplied id here — requests are always looked up
  // for the authenticated session's own userId, exactly like the
  // Professional dashboard looks up "my professional profile".
  const requests = await makeGetCustomerServiceRequestsUseCase().execute(user.id);

  return (
    <div className="mx-auto flex w-full max-w-3xl flex-col gap-6">
      <PageHeader
        title="My requests"
        subtitle="Service requests you've posted for professionals to quote on."
        actions={<ButtonLink href="/requests/new">New request</ButtonLink>}
      />

      {requests.length === 0 ? (
        <EmptyState
          icon={FileText}
          title="No service requests yet"
          description="You haven't posted any service requests yet."
          action={<ButtonLink href="/requests/new">New request</ButtonLink>}
        />
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
