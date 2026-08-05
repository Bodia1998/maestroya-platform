import { notFound } from "next/navigation";

import { reactivateCompanyFormAction, suspendCompanyFormAction } from "@/app/(dashboard)/admin/companies/actions";
import { makeGetAdminCompanyUseCase } from "@/application/use-cases/admin/compose";
import { DomainError } from "@/domain/errors/domain-error";
import { PageHeader } from "@/components/dashboard/page-header";

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

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title={company.tradeName ?? company.legalName}
        subtitle={company.legalName}
        breadcrumbs={[{ label: "Companies", href: "/admin/companies" }, { label: company.tradeName ?? company.legalName }]}
      />

      <dl className="grid grid-cols-2 gap-x-8 gap-y-2 text-sm">
        <dt className="text-foreground/60">Tax ID</dt>
        <dd>{company.taxId}</dd>
        <dt className="text-foreground/60">Owner</dt>
        <dd>{company.ownerName ?? company.ownerEmail ?? "—"}</dd>
        <dt className="text-foreground/60">Status</dt>
        <dd>{company.status}</dd>
        <dt className="text-foreground/60">Verified</dt>
        <dd>{company.isVerified ? "Yes" : "No"}</dd>
        <dt className="text-foreground/60">Members</dt>
        <dd>{company.memberCount}</dd>
        <dt className="text-foreground/60">Rating</dt>
        <dd>{company.averageRating !== null ? `${company.averageRating} (${company.reviewCount})` : "—"}</dd>
        <dt className="text-foreground/60">Created</dt>
        <dd>{company.createdAt.toLocaleDateString()}</dd>
      </dl>

      <div className="flex gap-2">
        {(company.status === "ACTIVE" || company.status === "PENDING") && (
          <form action={suspendCompanyFormAction.bind(null, company.id)}>
            <button type="submit" className="rounded-md border border-border px-3 py-1.5 text-sm">
              Suspend company
            </button>
          </form>
        )}
        {company.status === "SUSPENDED" && (
          <form action={reactivateCompanyFormAction.bind(null, company.id)}>
            <button type="submit" className="rounded-md border border-border px-3 py-1.5 text-sm">
              Reactivate company
            </button>
          </form>
        )}
      </div>
    </div>
  );
}
