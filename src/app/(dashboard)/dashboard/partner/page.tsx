import { Handshake } from "lucide-react";

import { requireAuth } from "@/infrastructure/auth/rbac";
import {
  makeGetPartnerByUserIdUseCase,
  makeGetPartnerDashboardStatisticsUseCase,
  makeListPartnerReferralCodesUseCase,
} from "@/application/use-cases/affiliate/compose";
import { CampaignManager } from "./campaign-manager";
import { PageHeader } from "@/components/dashboard/page-header";
import { PageContainer } from "@/components/layout/page-container";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { Text } from "@/components/ui/typography";

export const metadata = { title: "Partner dashboard" };

/**
 * Module 96 — Referral & Affiliate Production Wiring.
 *
 * The partner-facing dashboard `GetPartnerDashboardStatisticsUseCase`
 * (Module 61) previously had no route at all — see the implementation
 * report's "Confirmed unwired" findings.
 *
 * ## Isolation — never trusts a client-supplied partnerId
 * `partnerId` is resolved exclusively from the authenticated session's
 * own `userId` via `GetPartnerByUserIdUseCase` (mirrors
 * `ProfessionalDashboardPage`'s own "never trust a client-supplied id"
 * convention for `GetProfessionalByUserIdUseCase` exactly). There is no
 * query param, form field, or route segment carrying a partnerId
 * anywhere on this page — a signed-in partner can only ever see the
 * dashboard resolved from their own account, and a signed-in user with no
 * Partner account at all sees the "become a partner" empty state, never
 * another partner's data or a 404 that could be used to enumerate
 * partner ids.
 */
export default async function PartnerDashboardPage() {
  const user = await requireAuth();
  const partner = await makeGetPartnerByUserIdUseCase().execute(user.id);

  if (!partner) {
    return (
      <PageContainer maxWidth="3xl">
        <PageHeader title="Partner dashboard" subtitle="Track your referral links, clicks, and affiliate earnings." />
        <EmptyState
          icon={Handshake}
          title="You don't have a partner account yet"
          description="Partner accounts are for affiliates who refer customers to MaestroYa in exchange for a share of the platform's profit. Contact MaestroYa to register as a partner."
        />
      </PageContainer>
    );
  }

  if (partner.status !== "APPROVED") {
    return (
      <PageContainer maxWidth="3xl">
        <PageHeader title="Partner dashboard" subtitle="Track your referral links, clicks, and affiliate earnings." />
        <EmptyState
          icon={Handshake}
          title={partnerStatusMessage(partner.status)}
          description="Your dashboard will unlock automatically once your partner account is approved."
        />
      </PageContainer>
    );
  }

  const stats = await makeGetPartnerDashboardStatisticsUseCase().execute(partner.id);
  const campaignLinks = await makeListPartnerReferralCodesUseCase().execute(partner.id);

  return (
    <PageContainer maxWidth="6xl">
      <PageHeader
        title="Partner dashboard"
        subtitle={`Welcome back, ${partner.displayName}. Here's how your referral links are performing.`}
      />

      <section className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-4">
        <StatCard label="Clicks" value={stats.clicks.toLocaleString()} />
        <StatCard label="Visits" value={stats.visits.toLocaleString()} />
        <StatCard label="Registrations" value={stats.registrations.toLocaleString()} />
        <StatCard label="Bookings created" value={stats.bookingsCreated.toLocaleString()} />
        <StatCard label="Completed jobs" value={stats.completedJobs.toLocaleString()} />
        <StatCard label="Conversion rate" value={`${(stats.conversionRate * 100).toFixed(1)}%`} />
        <StatCard label="Platform commission generated" value={`€${stats.platformCommissionGenerated.toFixed(2)}`} />
      </section>

      <section className="mt-6 grid grid-cols-1 gap-4 sm:grid-cols-3">
        <StatCard label="Pending earnings" value={`€${stats.affiliateEarnings.pendingTotal.toFixed(2)}`} tone="muted" />
        <StatCard label="Approved (payable)" value={`€${stats.affiliateEarnings.approvedTotal.toFixed(2)}`} tone="accent" />
        <StatCard label="Paid to date" value={`€${stats.affiliateEarnings.paidTotal.toFixed(2)}`} />
      </section>

      <section className="mt-8 grid grid-cols-1 gap-6 md:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>Top campaigns</CardTitle>
          </CardHeader>
          <CardContent>
            {stats.topCampaigns.length === 0 ? (
              <Text size="sm" tone="muted">
                No campaign clicks recorded yet.
              </Text>
            ) : (
              <ul className="flex flex-col gap-2">
                {stats.topCampaigns.map((c) => (
                  <li key={c.campaign} className="flex items-center justify-between text-sm">
                    <span className="truncate">{c.campaign}</span>
                    <span className="text-muted-foreground">{c.visits} visits</span>
                  </li>
                ))}
              </ul>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Top referral links</CardTitle>
          </CardHeader>
          <CardContent>
            {stats.topReferralCodes.length === 0 ? (
              <Text size="sm" tone="muted">
                No referral link clicks recorded yet.
              </Text>
            ) : (
              <ul className="flex flex-col gap-2">
                {stats.topReferralCodes.map((r) => (
                  <li key={r.referralCode} className="flex items-center justify-between text-sm">
                    <span className="truncate font-mono">/r/{r.referralCode}</span>
                    <span className="text-muted-foreground">{r.visits} visits</span>
                  </li>
                ))}
              </ul>
            )}
          </CardContent>
        </Card>
      </section>

      <section className="mt-8">
        <CampaignManager initialLinks={campaignLinks} />
      </section>
    </PageContainer>
  );
}

function partnerStatusMessage(status: string): string {
  switch (status) {
    case "PENDING":
      return "Your partner application is pending review";
    case "REJECTED":
      return "Your partner application was not approved";
    case "SUSPENDED":
      return "Your partner account is currently suspended";
    case "BANNED":
      return "Your partner account has been banned";
    default:
      return "Your partner account isn't active";
  }
}

function StatCard({ label, value, tone }: { label: string; value: string; tone?: "muted" | "accent" }) {
  return (
    <Card>
      <CardContent className="flex flex-col gap-1 p-4">
        <Text size="xs" tone="muted">
          {label}
        </Text>
        <Text size="xl" weight="bold" tone={tone === "accent" ? "primary" : "default"}>
          {value}
        </Text>
      </CardContent>
    </Card>
  );
}
