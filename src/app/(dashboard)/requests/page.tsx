import { FileText } from "lucide-react";

import { requireAuth } from "@/infrastructure/auth/rbac";
import { makeGetCustomerServiceRequestsUseCase } from "@/application/use-cases/service-request/compose";
import { PageHeader } from "@/components/dashboard/page-header";
import { RequestCard } from "@/components/dashboard/cards/request-card";
import { ButtonLink } from "@/components/ui/button-link";
import { EmptyState } from "@/components/ui/empty-state";

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
          description="You haven't posted any service requests yet. Post one to start getting quotes from professionals near you."
          action={<ButtonLink href="/requests/new">New request</ButtonLink>}
        />
      ) : (
        <ul className="flex flex-col gap-3">
          {requests.map((request) => (
            <li key={request.id}>
              <RequestCard
                href={`/requests/${request.id}`}
                title={request.title}
                status={request.status}
                categoryName={request.categoryName}
                city={request.location.city}
                createdAt={request.createdAt}
                updatedAt={request.updatedAt}
              />
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
