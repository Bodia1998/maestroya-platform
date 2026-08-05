import Link from "next/link";
import { notFound } from "next/navigation";

import { NotFoundError } from "@/domain/errors/domain-error";
import { requireAuth } from "@/infrastructure/auth/rbac";
import { makeGetServiceRequestUseCase } from "@/application/use-cases/service-request/compose";
import { PageHeader } from "@/components/dashboard/page-header";
import { PageContainer } from "@/components/layout/page-container";
import { Section } from "@/components/layout/section";
import { ResponsiveGrid } from "@/components/layout/responsive-grid";
import { ActionBar } from "@/components/layout/action-bar";
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
    <PageContainer>
      <PageHeader
        title={request.title}
        subtitle={request.categoryName}
        breadcrumbs={[{ label: "My requests", href: "/requests" }, { label: request.title }]}
        actions={<RequestStatusBadge status={request.status} />}
      />

      <Section title="Description" gap="sm">
        <p className="whitespace-pre-line text-sm text-foreground/80">{request.description}</p>
      </Section>

      <ResponsiveGrid cols="2" gap="md" bordered>
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
      </ResponsiveGrid>

      <Section title="Photos">
        <ServiceRequestPhotoManager
          requestId={request.id}
          photos={request.photos}
          editable={isEditable}
        />
      </Section>

      {request.status === "ACCEPTED" && (
        <section className="rounded-md border border-border bg-black/5 p-4">
          <p className="text-sm">
            You&apos;ve accepted a quote for this request. Head to{" "}
            <Link href="/appointments" className="font-medium underline">
              My appointments
            </Link>{" "}
            to propose or confirm a time, or check{" "}
            <Link href="/jobs" className="font-medium underline">
              My jobs
            </Link>{" "}
            for the work&apos;s overall progress.
          </p>
        </section>
      )}

      {isEditable && (
        <ActionBar>
          <Link
            href={`/requests/${request.id}/edit`}
            className="inline-flex h-10 items-center justify-center rounded-md border border-border bg-transparent px-4 text-sm font-medium hover:bg-black/5"
          >
            Edit request
          </Link>
          <CancelServiceRequestDialog requestId={request.id} />
        </ActionBar>
      )}
    </PageContainer>
  );
}
