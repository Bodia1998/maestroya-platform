import { notFound } from "next/navigation";

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

export const metadata = { title: "Admin — Partner detail" };

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

  return (
    <div className="flex flex-col gap-8">
      <PageHeader
        title={partner.displayName}
        subtitle={`${partner.type} · ${partner.contactEmail} · payout via ${partner.payoutMethod}`}
        actions={<StatusBadge status={partner.status} />}
      />

      <Card>
        <CardHeader>
          <CardTitle>Status</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-wrap gap-3">
          {partner.status === "PENDING" && (
            <>
              <form action={approvePartnerFormAction.bind(null, partner.id)}>
                <Button type="submit" variant="default">
                  Approve
                </Button>
              </form>
              <form action={rejectPartnerFormAction.bind(null, partner.id)} className="flex flex-col gap-2">
                <Label htmlFor="reject-reason">Rejection reason</Label>
                <Textarea id="reject-reason" name="reason" required minLength={5} maxLength={1000} rows={2} />
                <Button type="submit" variant="danger" className="w-fit">
                  Reject
                </Button>
              </form>
            </>
          )}
          {(partner.status === "APPROVED" || partner.status === "SUSPENDED") && (
            <form action={suspendPartnerFormAction.bind(null, partner.id)} className="flex flex-col gap-2">
              <Label htmlFor="suspend-reason">Suspension reason</Label>
              <Textarea id="suspend-reason" name="reason" required minLength={5} maxLength={1000} rows={2} />
              <Button type="submit" variant="outline" className="w-fit">
                {partner.status === "SUSPENDED" ? "Reinstate" : "Suspend"}
              </Button>
            </form>
          )}
          {partner.status !== "BANNED" && (
            <form action={banPartnerFormAction.bind(null, partner.id)} className="flex flex-col gap-2">
              <Label htmlFor="ban-reason">Ban reason</Label>
              <Textarea id="ban-reason" name="reason" required minLength={5} maxLength={1000} rows={2} />
              <Button type="submit" variant="danger" className="w-fit">
                Ban
              </Button>
            </form>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Referral links ({referralCodes.length})</CardTitle>
        </CardHeader>
        <CardContent>
          {referralCodes.length === 0 ? (
            <Text size="sm" tone="muted">
              No referral links generated yet.
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
          Affiliate commissions ({affiliateCommissions.length})
        </Text>
        {affiliateCommissions.length === 0 ? (
          <Text size="sm" tone="muted">
            No commissions recorded yet.
          </Text>
        ) : (
          <AdminDataTable caption="Affiliate commissions" minWidth={760}>
            <AdminTableHeadRow>
              <AdminTh>Referral code</AdminTh>
              <AdminTh>Platform commission</AdminTh>
              <AdminTh>Profit base</AdminTh>
              <AdminTh>Affiliate amount</AdminTh>
              <AdminTh>Reversed</AdminTh>
              <AdminTh>Status</AdminTh>
              <AdminTh>Actions</AdminTh>
            </AdminTableHeadRow>
            <AdminTableBody>
              {affiliateCommissions.map((commission) => (
                <AdminTableRow key={commission.id}>
                  <td className="px-4 py-3 font-mono text-xs">{commission.referralCode}</td>
                  <td className="px-4 py-3">€{commission.platformCommissionAmount.toFixed(2)}</td>
                  <td className="px-4 py-3">€{commission.profitBaseAmount.toFixed(2)}</td>
                  <td className="px-4 py-3">€{commission.affiliateAmount.toFixed(2)}</td>
                  <td className="px-4 py-3">{commission.reversedAmount > 0 ? `€${commission.reversedAmount.toFixed(2)}` : "—"}</td>
                  <td className="px-4 py-3">
                    <StatusBadge status={commission.status} />
                  </td>
                  <td className="px-4 py-3">
                    <div className="flex flex-wrap gap-2">
                      {commission.status === "PENDING" && (
                        <form action={approveAffiliateCommissionFormAction.bind(null, commission.id, partner.id)}>
                          <AdminRowActionButton>
                            Approve<span className="sr-only"> commission {commission.id}</span>
                          </AdminRowActionButton>
                        </form>
                      )}
                      {(commission.status === "PENDING" || commission.status === "APPROVED") && (
                        <form
                          action={cancelAffiliateCommissionFormAction.bind(null, commission.id, partner.id)}
                          className="flex items-center gap-2"
                        >
                          <input type="text" name="reason" placeholder="Reason" required maxLength={500} className="h-8 w-32 rounded-md border border-border px-2 text-xs" />
                          <AdminRowActionButton>
                            Cancel<span className="sr-only"> commission {commission.id}</span>
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
          <CardTitle>Create payout</CardTitle>
        </CardHeader>
        <CardContent>
          <Text size="sm" tone="muted" className="mb-3">
            Settles this partner&apos;s entire outstanding APPROVED commission balance into one payout batch, gated on
            their minimum payout threshold. For a STRIPE-method partner this executes a real Stripe Connect transfer to
            the account on file for this partner — never to any other account.
          </Text>
          <form action={createPartnerPayoutFormAction.bind(null, partner.id)} className="flex flex-wrap items-end gap-3">
            <div className="flex flex-col gap-1">
              <Label htmlFor="payout-period-start">Period start</Label>
              <input id="payout-period-start" name="periodStart" type="date" required className="h-9 rounded-md border border-border px-2 text-sm" />
            </div>
            <div className="flex flex-col gap-1">
              <Label htmlFor="payout-period-end">Period end</Label>
              <input id="payout-period-end" name="periodEnd" type="date" required className="h-9 rounded-md border border-border px-2 text-sm" />
            </div>
            <Button type="submit" variant="default">
              Create payout
            </Button>
          </form>
        </CardContent>
      </Card>

      <section>
        <Text size="sm" weight="semibold" className="mb-2">
          Payouts ({payouts.length})
        </Text>
        {payouts.length === 0 ? (
          <Text size="sm" tone="muted">
            No payouts yet.
          </Text>
        ) : (
          <AdminDataTable caption="Partner payouts" minWidth={640}>
            <AdminTableHeadRow>
              <AdminTh>Period</AdminTh>
              <AdminTh>Amount</AdminTh>
              <AdminTh>Method</AdminTh>
              <AdminTh>Reference</AdminTh>
              <AdminTh>Status</AdminTh>
            </AdminTableHeadRow>
            <AdminTableBody>
              {payouts.map((payout) => (
                <AdminTableRow key={payout.id}>
                  <td className="px-4 py-3 text-xs">
                    {payout.periodStart.toISOString().slice(0, 10)} → {payout.periodEnd.toISOString().slice(0, 10)}
                  </td>
                  <td className="px-4 py-3">€{payout.amount.toFixed(2)}</td>
                  <td className="px-4 py-3">{payout.method}</td>
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
          Fraud flags ({fraudFlags.length})
        </Text>
        {fraudFlags.length === 0 ? (
          <Text size="sm" tone="muted">
            No fraud flags raised.
          </Text>
        ) : (
          <ul className="flex flex-col gap-3">
            {fraudFlags.map((flag) => (
              <li key={flag.id} className="rounded-md border border-border p-3">
                <div className="flex items-center justify-between gap-3">
                  <span className="text-sm font-medium">{flag.type}</span>
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
                      placeholder="Resolution note"
                      required
                      maxLength={500}
                      className="h-8 flex-1 rounded-md border border-border px-2 text-xs"
                    />
                    <AdminRowActionButton>Mark reviewed</AdminRowActionButton>
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

