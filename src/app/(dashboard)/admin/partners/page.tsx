import Link from "next/link";
import { Handshake } from "lucide-react";
import { getTranslations } from "next-intl/server";

import { listAdminPartnersAction } from "./actions";
import { PageHeader } from "@/components/dashboard/page-header";
import { AdminDataTable, AdminTableHeadRow, AdminTh, AdminTableBody, AdminTableRow } from "@/components/dashboard/admin-data-table";
import { AdminFilterForm } from "@/components/dashboard/admin-filter-form";
import { StatusBadge } from "@/components/dashboard/status-badge";
import { EmptyState } from "@/components/ui/empty-state";
import { Select } from "@/components/ui/select";

export async function generateMetadata() {
  const t = await getTranslations("admin");
  return { title: t("common.metaTitle", { page: t("partners.title") }) };
}

const PARTNER_STATUS_OPTIONS = ["PENDING", "APPROVED", "REJECTED", "SUSPENDED", "BANNED"] as const;

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

  const t = await getTranslations("admin");
  const enumLabel = (group: string, value: string) =>
    t.has(`${group}.${value}` as never) ? t(`${group}.${value}` as never) : value;

  return (
    <div className="flex flex-col gap-6">
      <PageHeader title={t("partners.title")} subtitle={t("partners.subtitle")} />

      {!result.success && (
        <p role="alert" className="rounded-md bg-red-100 px-3 py-2 text-sm text-red-700">
          {result.error}
        </p>
      )}

      <AdminFilterForm aria-label={t("partners.filterLabel")} submitLabel={t("table.filter")}>
        <Select name="status" defaultValue={status ?? ""} aria-label={t("common.filterByStatus")} className="h-10 w-auto">
          <option value="">{t("common.allStatuses")}</option>
          {PARTNER_STATUS_OPTIONS.map((value) => (
            <option key={value} value={value}>
              {t(`partners.status.${value}`)}
            </option>
          ))}
        </Select>
      </AdminFilterForm>

      {partners.length === 0 ? (
        <EmptyState icon={Handshake} title={t("partners.empty")} description={t("partners.emptyDescription")} />
      ) : (
        <AdminDataTable caption={t("partners.title")} minWidth={640}>
          <AdminTableHeadRow>
            <AdminTh>{t("common.columns.name")}</AdminTh>
            <AdminTh>{t("partners.columns.type")}</AdminTh>
            <AdminTh>{t("partners.columns.contact")}</AdminTh>
            <AdminTh>{t("partners.columns.payoutMethod")}</AdminTh>
            <AdminTh>{t("common.columns.status")}</AdminTh>
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
                <td className="px-4 py-3">{enumLabel("partners.type", partner.type)}</td>
                <td className="px-4 py-3">{partner.contactEmail}</td>
                <td className="px-4 py-3">{enumLabel("partners.payoutMethod", partner.payoutMethod)}</td>
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
