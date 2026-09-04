import Link from "next/link";
import { Handshake } from "lucide-react";

import { listAdminPartnersAction } from "./actions";
import { PageHeader } from "@/components/dashboard/page-header";
import { AdminDataTable, AdminTableHeadRow, AdminTh, AdminTableBody, AdminTableRow } from "@/components/dashboard/admin-data-table";
import { AdminFilterForm } from "@/components/dashboard/admin-filter-form";
import { StatusBadge } from "@/components/dashboard/status-badge";
import { EmptyState } from "@/components/ui/empty-state";
import { Select } from "@/components/ui/select";

export const metadata = { title: "Admin — Partners" };

type SearchParams = Promise<{ status?: string }>;

/**
 * Module 96 — Referral & Affiliate Production Wiring: admin partner
 * oversight — list, filter by status. `GetAdminPartnerAuditUseCase`
 * (commissions/payouts/fraud flags/reversals) lives on the per-partner
 * detail page (`[id]/page.tsx`). Kept functional and correct over
 * visually polished, matching this module's remaining-scope priority —
 * same "functional, not polished" decision `disputes/page.tsx` documents
 * for the identical reason.
 */
export default async function AdminPartnersPage({ searchParams }: { searchParams: SearchParams }) {
  const { status } = await searchParams;
  const result = await listAdminPartnersAction(status as never);
  const partners = result.success ? result.data : [];

  return (
    <div className="flex flex-col gap-6">
      <PageHeader title="Partners" subtitle="Affiliate/referral partners — approval, status, and referral performance." />

      {!result.success && (
        <p role="alert" className="rounded-md bg-red-100 px-3 py-2 text-sm text-red-700">
          {result.error}
        </p>
      )}

      <AdminFilterForm aria-label="Filter partners" submitLabel="Filter">
        <Select name="status" defaultValue={status ?? ""} aria-label="Filter by status" className="h-10 w-auto">
          <option value="">All statuses</option>
          <option value="PENDING">Pending</option>
          <option value="APPROVED">Approved</option>
          <option value="REJECTED">Rejected</option>
          <option value="SUSPENDED">Suspended</option>
          <option value="BANNED">Banned</option>
        </Select>
      </AdminFilterForm>

      {partners.length === 0 ? (
        <EmptyState icon={Handshake} title="No partners found" description="Partner applications will appear here." />
      ) : (
        <AdminDataTable caption="Partners" minWidth={640}>
          <AdminTableHeadRow>
            <AdminTh>Name</AdminTh>
            <AdminTh>Type</AdminTh>
            <AdminTh>Contact</AdminTh>
            <AdminTh>Payout method</AdminTh>
            <AdminTh>Status</AdminTh>
          </AdminTableHeadRow>
          <AdminTableBody>
            {partners.map((partner) => (
              <AdminTableRow key={partner.id}>
                <td className="px-4 py-3">
                  <Link
                    href={`/admin/partners/${partner.id}`}
                    className="font-medium text-primary underline-offset-2 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring rounded-sm"
                  >
                    {partner.displayName}
                  </Link>
                </td>
                <td className="px-4 py-3">{partner.type}</td>
                <td className="px-4 py-3">{partner.contactEmail}</td>
                <td className="px-4 py-3">{partner.payoutMethod}</td>
                <td className="px-4 py-3">
                  <StatusBadge status={partner.status} />
                </td>
              </AdminTableRow>
            ))}
          </AdminTableBody>
        </AdminDataTable>
      )}
    </div>
  );
}
