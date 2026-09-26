import { notFound } from "next/navigation";
import { getFormatter, getTranslations } from "next-intl/server";

import {
  approveAffiliateCommissionFormAction,
  approvePartnerFormAction,
  banPartnerFormAction,
  cancelAffiliateCommissionFormAction,
  createPartnerPayoutFormAction,
  getAdminPartnerAuditAction,
  rejectPartnerFormAction,
  resolveFraudFlagFormAction,
  suspendPartnerFormAction,
} from "../actions";
import { PageHeader } from "@/components/dashboard/page-header";
import { AdminDataTable, AdminTableHeadRow, AdminTh, AdminTableBody, AdminTableRow } from "@/components/dashboard/admin-data-table";
import { AdminRowActionButton } from "@/components/dashboard/admin-row-action-button";
import { StatusBadge } from "@/components/dashboard/status-badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Button } from "@/components/ui/button";
import { Text } from "@/components/ui/typography";

export async function generateMetadata() {
  const t = await getTranslations("admin");
  return { title: t("common.metaTitle", { page: t("partners.detail.metaTitle") }) };
}

/**
 * Module 96 — Referral & Affiliate Production Wiring: the admin's single
 * "audit this partner" screen — `GetAdminPartnerAuditUseCase` (Module 61,
 * previously had no route) plus every mutation an admin can take from it:
 * approve/reject/suspend/ban the partner, approve/cancel an individual
 * commission, resolve a fraud flag. Every mutation reuses the existing
 * use case/repository (never a new, parallel financial mechanism), gated
 * by `requireRole(ROLES.ADMIN, ROLES.SUPER_ADMIN)` in `actions.ts` — the
 * same fresh-DB-backed admin authorization pattern `admin/disputes`/
 * `admin/companies` already use, not JWT-claims-only.
 */
export default async function AdminPartnerDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const result = await getAdminPartnerAuditAction(id);
  if (!result.success) {
    notFound();
  }
  const { partner, referralCodes, affiliateCommissions, payouts, fraudFlags } = result.data;
  const t = await getTranslations("admin");
  const format = await getFormatter();
  const enumLabel = (group: string, value: string) =>
    t.has(`${group}.${value}` as never) ? t(`${group}.${value}` as never) : value;
  const srOnly = (chunks: React.ReactNode) => <span className="sr-only">{chunks}</span>;
  const periodDate = (date: Date) => format.dateTime(date, { dateStyle: "medium", timeZone: "UTC" });

  return (
    <div className="flex flex-col gap-8">
      <PageHeader
        title={partner.displayName}
        subtitle={t("partners.detail.subtitle", {
          type: enumLabel("partners.type", partner.type),
          email: partner.contactEmail,
          method: enumLabel("partners.payoutMethod", partner.payoutMethod),
        })}
        actions={<StatusBadge status={partner.status} />}
      />

      <Card>
        <CardHeader>
          <CardTitle>{t("partners.detail.status")}</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-wrap gap-3">
          {partner.status === "PENDING" && (
            <>
              <form action={approvePartnerFormAction.bind(null, partner.id)}>
                <Button type="submit" variant="default">
                  {t("partners.detail.approve")}
                </Button>
              </form>
              <form action={rejectPartnerFormAction.bind(null, partner.id)} className="flex flex-col gap-2">
                <Label htmlFor="reject-reason">{t("partners.detail.rejectionReason")}</Label>
                <Textarea id="reject-reason" name="reason" required minLength={5} maxLength={1000} rows={2} />
                <Button type="submit" variant="danger" className="w-fit">
                  {t("partners.detail.reject")}
                </Button>
              </form>
            </>
          )}
          {(partner.status === "APPROVED" || partner.status === "SUSPENDED") && (
            <form action={suspendPartnerFormAction.bind(null, partner.id)} className="flex flex-col gap-2">
              <Label htmlFor="suspend-reason">{t("partners.detail.suspensionReason")}</Label>
              <Textarea id="suspend-reason" name="reason" required minLength={5} maxLength={1000} rows={2} />
              <Button type="submit" variant="outline" className="w-fit">
                {partner.status === "SUSPENDED" ? t("partners.detail.reinstate") : t("partners.detail.suspend")}
              </Button>
            </form>
          )}
          {partner.status !== "BANNED" && (
            <form action={banPartnerFormAction.bind(null, partner.id)} className="flex flex-col gap-2">
              <Label htmlFor="ban-reason">{t("partners.detail.banReason")}</Label>
              <Textarea id="ban-reason" name="reason" required minLength={5} maxLength={1000} rows={2} />
              <Button type="submit" variant="danger" className="w-fit">
                {t("partners.detail.ban")}
              </Button>
            </form>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>{t("partners.detail.referralLinks", { count: referralCodes.length })}</CardTitle>
        </CardHeader>
        <CardContent>
          {referralCodes.length === 0 ? (
            <Text size="sm" tone="muted">
              {t("partners.detail.noReferralLinks")}
            </Text>
          ) : (
            <ul className="flex flex-col gap-1">
              {referralCodes.map((code) => (
                <li key={code.id} className="font-mono text-sm">
                  /r/{code.code} {code.label ? <span className="text-muted-foreground">— {code.label}</span> : null}
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>

      <section>
        <Text size="sm" weight="semibold" className="mb-2">
          {t("partners.detail.commissions", { count: affiliateCommissions.length })}
        </Text>
        {affiliateCommissions.length === 0 ? (
          <Text size="sm" tone="muted">
            {t("partners.detail.noCommissions")}
          </Text>
        ) : (
          <AdminDataTable caption={t("partners.detail.commissionsCaption")} minWidth={760}>
            <AdminTableHeadRow>
              <AdminTh>{t("partners.detail.columns.referralCode")}</AdminTh>
              <AdminTh>{t("partners.detail.columns.platformCommission")}</AdminTh>
              <AdminTh>{t("partners.detail.columns.profitBase")}</AdminTh>
              <AdminTh>{t("partners.detail.columns.affiliateAmount")}</AdminTh>
              <AdminTh>{t("partners.detail.columns.reversed")}</AdminTh>
              <AdminTh>{t("common.columns.status")}</AdminTh>
              <AdminTh>{t("common.columns.actions")}</AdminTh>
            </AdminTableHeadRow>
            <AdminTableBody>
              {affiliateCommissions.map((commission) => (
                <AdminTableRow key={commission.id}>
                  <td className="px-4 py-3 font-mono text-xs">{commission.referralCode}</td>
                  <td className="px-4 py-3">{format.number(commission.platformCommissionAmount, { style: "currency", currency: "EUR" })}</td>
                  <td className="px-4 py-3">{format.number(commission.profitBaseAmount, { style: "currency", currency: "EUR" })}</td>
                  <td className="px-4 py-3">{format.number(commission.affiliateAmount, { style: "currency", currency: "EUR" })}</td>
                  <td className="px-4 py-3">{commission.reversedAmount > 0 ? format.number(commission.reversedAmount, { style: "currency", currency: "EUR" }) : "—"}</td>
                  <td className="px-4 py-3">
                    <StatusBadge status={commission.status} />
                  </td>
                  <td className="px-4 py-3">
                    <div className="flex flex-wrap gap-2">
                      {commission.status === "PENDING" && (
                        <form action={approveAffiliateCommissionFormAction.bind(null, commission.id, partner.id)}>
                          <AdminRowActionButton>
                            {t.rich("partners.detail.approveCommission", { id: commission.id, sr: srOnly })}
                          </AdminRowActionButton>
                        </form>
                      )}
                      {(commission.status === "PENDING" || commission.status === "APPROVED") && (
                        <form
                          action={cancelAffiliateCommissionFormAction.bind(null, commission.id, partner.id)}
                          className="flex items-center gap-2"
                        >
                          <input type="text" name="reason" placeholder={t("partners.detail.reasonPlaceholder")} required maxLength={500} className="h-8 w-32 rounded-md border border-border px-2 text-xs" />
                          <AdminRowActionButton>
                            {t.rich("partners.detail.cancelCommission", { id: commission.id, sr: srOnly })}
                          </AdminRowActionButton>
                        </form>
                      )}
                    </div>
                  </td>
                </AdminTableRow>
              ))}
            </AdminTableBody>
          </AdminDataTable>
        )}
      </section>

      <Card>
        <CardHeader>
          <CardTitle>{t("partners.detail.createPayout")}</CardTitle>
        </CardHeader>
        <CardContent>
          <Text size="sm" tone="muted" className="mb-3">
            {t("partners.detail.createPayoutHelp")}
          </Text>
          <form action={createPartnerPayoutFormAction.bind(null, partner.id)} className="flex flex-wrap items-end gap-3">
            <div className="flex flex-col gap-1">
              <Label htmlFor="payout-period-start">{t("partners.detail.periodStart")}</Label>
              <input id="payout-period-start" name="periodStart" type="date" required className="h-9 rounded-md border border-border px-2 text-sm" />
            </div>
            <div className="flex flex-col gap-1">
              <Label htmlFor="payout-period-end">{t("partners.detail.periodEnd")}</Label>
              <input id="payout-period-end" name="periodEnd" type="date" required className="h-9 rounded-md border border-border px-2 text-sm" />
            </div>
            <Button type="submit" variant="default">
              {t("partners.detail.createPayout")}
            </Button>
          </form>
        </CardContent>
      </Card>

      <section>
        <Text size="sm" weight="semibold" className="mb-2">
          {t("partners.detail.payouts", { count: payouts.length })}
        </Text>
        {payouts.length === 0 ? (
          <Text size="sm" tone="muted">
            {t("partners.detail.noPayouts")}
          </Text>
        ) : (
          <AdminDataTable caption={t("partners.detail.payoutsCaption")} minWidth={640}>
            <AdminTableHeadRow>
              <AdminTh>{t("partners.detail.columns.period")}</AdminTh>
              <AdminTh>{t("partners.detail.columns.amount")}</AdminTh>
              <AdminTh>{t("partners.detail.columns.method")}</AdminTh>
              <AdminTh>{t("partners.detail.columns.reference")}</AdminTh>
              <AdminTh>{t("common.columns.status")}</AdminTh>
            </AdminTableHeadRow>
            <AdminTableBody>
              {payouts.map((payout) => (
                <AdminTableRow key={payout.id}>
                  <td className="px-4 py-3 text-xs">
                    {t("partners.detail.period", { start: periodDate(payout.periodStart), end: periodDate(payout.periodEnd) })}
                  </td>
                  <td className="px-4 py-3">{format.number(payout.amount, { style: "currency", currency: "EUR" })}</td>
                  <td className="px-4 py-3">{enumLabel("partners.payoutMethod", payout.method)}</td>
                  <td className="px-4 py-3 font-mono text-xs">{payout.reference ?? "—"}</td>
                  <td className="px-4 py-3">
                    <StatusBadge status={payout.status} />
                  </td>
                </AdminTableRow>
              ))}
            </AdminTableBody>
          </AdminDataTable>
        )}
      </section>

      <section>
        <Text size="sm" weight="semibold" className="mb-2">
          {t("partners.detail.fraudFlags", { count: fraudFlags.length })}
        </Text>
        {fraudFlags.length === 0 ? (
          <Text size="sm" tone="muted">
            {t("partners.detail.noFraudFlags")}
          </Text>
        ) : (
          <ul className="flex flex-col gap-3">
            {fraudFlags.map((flag) => (
              <li key={flag.id} className="rounded-md border border-border p-3">
                <div className="flex items-center justify-between gap-3">
                  <span className="text-sm font-medium">{enumLabel("partners.fraudFlagType", flag.type)}</span>
                  <StatusBadge status={flag.status} />
                </div>
                <Text size="sm" tone="muted" className="mt-1">
                  {flag.detail}
                </Text>
                {flag.status === "OPEN" && (
                  <form action={resolveFraudFlagFormAction.bind(null, flag.id, partner.id, "REVIEWED")} className="mt-2 flex items-center gap-2">
                    <input
                      type="text"
                      name="resolution"
                      placeholder={t("partners.detail.resolutionNote")}
                      required
                      maxLength={500}
                      className="h-8 flex-1 rounded-md border border-border px-2 text-xs"
                    />
                    <AdminRowActionButton>{t("partners.detail.markReviewed")}</AdminRowActionButton>
                  </form>
                )}
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}

