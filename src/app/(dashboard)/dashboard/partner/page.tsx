import { Handshake } from "lucide-react";
import { getFormatter, getTranslations } from "next-intl/server";

import { requireAuth } from "@/infrastructure/auth/rbac";
import {
  makeGetAffiliateBalanceUseCase,
  makeGetPartnerByUserIdUseCase,
  makeGetPartnerDashboardStatisticsUseCase,
  makeListAffiliatePayoutsUseCase,
  makeListPartnerReferralCodesUseCase,
} from "@/application/use-cases/affiliate/compose";
import { CampaignManager } from "./campaign-manager";
import { PayoutPanel } from "./payout-panel";
import { PageHeader } from "@/components/dashboard/page-header";
import { PageContainer } from "@/components/layout/page-container";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { Text } from "@/components/ui/typography";

export async function generateMetadata() {
  const t = await getTranslations("partner");
  return { title: t("metaTitle") };
}

const PARTNER_STATUS_KEYS = ["PENDING", "REJECTED", "SUSPENDED", "BANNED"] as const;
type PartnerStatusKey = (typeof PARTNER_STATUS_KEYS)[number];
function isPartnerStatusKey(status: string): status is PartnerStatusKey {
  return (PARTNER_STATUS_KEYS as readonly string[]).includes(status);
}

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
  const t = await getTranslations("partner");
  const format = await getFormatter();
  const euro = (amount: number) => format.number(amount, { style: "currency", currency: "EUR" });

  if (!partner) {
    return (
      <PageContainer maxWidth="3xl">
        <PageHeader title={t("title")} subtitle={t("subtitle")} />
        <EmptyState
          icon={Handshake}
          title={t("noAccount.title")}
          description={t("noAccount.description")}
        />
      </PageContainer>
    );
  }

  if (partner.status !== "APPROVED") {
    return (
      <PageContainer maxWidth="3xl">
        <PageHeader title={t("title")} subtitle={t("subtitle")} />
        <EmptyState
          icon={Handshake}
          title={
            isPartnerStatusKey(partner.status) ? t(`statusMessage.${partner.status}`) : t("statusMessage.other")
          }
          description={t("locked.description")}
        />
      </PageContainer>
    );
  }

  const stats = await makeGetPartnerDashboardStatisticsUseCase().execute(partner.id);
  const campaignLinks = await makeListPartnerReferralCodesUseCase().execute(partner.id);
  // Module 100 — Affiliate Accumulated Balance & €50 Payout.
  const balance = await makeGetAffiliateBalanceUseCase().execute(partner.id);
  const payoutHistory = await makeListAffiliatePayoutsUseCase().execute(partner.id);

  return (
    <PageContainer maxWidth="6xl">
      <PageHeader
        title={t("title")}
        subtitle={t("welcome", { name: partner.displayName })}
      />

      <section className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-4">
        <StatCard label={t("stats.clicks")} value={format.number(stats.clicks)} />
        <StatCard label={t("stats.visits")} value={format.number(stats.visits)} />
        <StatCard label={t("stats.registrations")} value={format.number(stats.registrations)} />
        <StatCard label={t("stats.bookingsCreated")} value={format.number(stats.bookingsCreated)} />
        <StatCard label={t("stats.completedJobs")} value={format.number(stats.completedJobs)} />
        <StatCard
          label={t("stats.conversionRate")}
          value={format.number(stats.conversionRate, {
            style: "percent",
            minimumFractionDigits: 1,
            maximumFractionDigits: 1,
          })}
        />
        <StatCard label={t("stats.platformCommissionGenerated")} value={euro(stats.platformCommissionGenerated)} />
      </section>

      <section className="mt-6 grid grid-cols-1 gap-4 sm:grid-cols-3">
        <StatCard label={t("stats.pendingEarnings")} value={euro(stats.affiliateEarnings.pendingTotal)} tone="muted" />
        <StatCard label={t("stats.approvedPayable")} value={euro(stats.affiliateEarnings.approvedTotal)} tone="accent" />
        <StatCard label={t("stats.paidToDate")} value={euro(stats.affiliateEarnings.paidTotal)} />
      </section>

      <section className="mt-8 grid grid-cols-1 gap-6 md:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>{t("topCampaigns.title")}</CardTitle>
          </CardHeader>
          <CardContent>
            {stats.topCampaigns.length === 0 ? (
              <Text size="sm" tone="muted">
                {t("topCampaigns.empty")}
              </Text>
            ) : (
              <ul className="flex flex-col gap-2">
                {stats.topCampaigns.map((c) => (
                  <li key={c.campaign} className="flex items-center justify-between text-sm">
                    <span className="truncate">{c.campaign}</span>
                    <span className="text-muted-foreground">{t("visitsCount", { count: c.visits })}</span>
                  </li>
                ))}
              </ul>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>{t("topReferralLinks.title")}</CardTitle>
          </CardHeader>
          <CardContent>
            {stats.topReferralCodes.length === 0 ? (
              <Text size="sm" tone="muted">
                {t("topReferralLinks.empty")}
              </Text>
            ) : (
              <ul className="flex flex-col gap-2">
                {stats.topReferralCodes.map((r) => (
                  <li key={r.referralCode} className="flex items-center justify-between text-sm">
                    <span className="truncate font-mono">/r/{r.referralCode}</span>
                    <span className="text-muted-foreground">{t("visitsCount", { count: r.visits })}</span>
                  </li>
                ))}
              </ul>
            )}
          </CardContent>
        </Card>
      </section>

      <section className="mt-8">
        <PayoutPanel balance={balance} payoutHistory={payoutHistory} />
      </section>

      <section className="mt-8">
        <CampaignManager initialLinks={campaignLinks} />
      </section>
    </PageContainer>
  );
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
