import { notFound } from "next/navigation";

import { reactivateCompanyFormAction, suspendCompanyFormAction } from "@/app/(dashboard)/admin/companies/actions";
import { makeGetAdminCompanyUseCase } from "@/application/use-cases/admin/compose";
import { DomainError } from "@/domain/errors/domain-error";
import { PageHeader } from "@/components/dashboard/page-header";
import { StatusBadge } from "@/components/dashboard/status-badge";
import { Section } from "@/components/layout/section";
import { ResponsiveGrid } from "@/components/layout/responsive-grid";
import { AdminRowActionButton } from "@/components/dashboard/admin-row-action-button";

export const metadata = { title: "Admin — Company detail" };

/** Module 18 — Company Professional: admin company detail — owner, member
 *  count, verification status, status transition actions. Never exposes
 *  member identities or verification documents here (that's
 *  /admin/company-verifications/[id] for documents, itself ADMIN-gated). */
export default async function AdminCompanyDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;

  let company;
  try {
    company = await makeGetAdminCompanyUseCase().execute(id);
  } catch (error) {
    if (error instanceof DomainError && error.code === "NOT_FOUND") notFound();
    throw error;
  }

  const canSuspend = company.status === "ACTIVE" || company.status === "PENDING";
  const canReactivate = company.status === "SUSPENDED";

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title={company.tradeName ?? company.legalName}
        subtitle={company.legalName}
        breadcrumbs={[{ label: "Companies", href: "/admin/companies" }, { label: company.tradeName ?? company.legalName }]}
        actions={<StatusBadge status={company.status} />}
      />

      <Section title="Company details">
        <ResponsiveGrid as="dl" cols="2" gap="md" bordered className="text-sm">
          <dt className="text-foreground/60">Tax ID</dt>
          <dd>{company.taxId}</dd>
          <dt className="text-foreground/60">Owner</dt>
          <dd>{company.ownerName ?? company.ownerEmail ?? "—"}</dd>
          <dt className="text-foreground/60">Status</dt>
          <dd>
            <StatusBadge status={company.status} />
          </dd>
          <dt className="text-foreground/60">Verified</dt>
          <dd>{company.isVerified ? "Yes" : "No"}</dd>
          <dt className="text-foreground/60">Members</dt>
          <dd>{company.memberCount}</dd>
          <dt className="text-foreground/60">Rating</dt>
          <dd>{company.averageRating !== null ? `${company.averageRating} (${company.reviewCount})` : "—"}</dd>
          <dt className="text-foreground/60">Created</dt>
          <dd>{company.createdAt.toLocaleDateString()}</dd>
        </ResponsiveGrid>
      </Section>

      {(canSuspend || canReactivate) && (
        <Section title="Admin actions" bordered>
          <div className="flex flex-wrap gap-2">
            {canSuspend && (
              <form action={suspendCompanyFormAction.bind(null, company.id)}>
                <AdminRowActionButton className="h-10 px-4 text-sm">Suspend company</AdminRowActionButton>
              </form>
            )}
            {canReactivate && (
              <form action={reactivateCompanyFormAction.bind(null, company.id)}>
                <AdminRowActionButton className="h-10 px-4 text-sm">Reactivate company</AdminRowActionButton>
              </form>
            )}
          </div>
        </Section>
      )}
    </div>
  );
}
