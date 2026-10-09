import type { Metadata } from "next";
import Link from "next/link";
import { getFormatter, getTranslations } from "next-intl/server";

import { NotFoundError } from "@/domain/errors/domain-error";
import { requireAuth } from "@/infrastructure/auth/rbac";
import { EMPTY_BILLING_IDENTITY_VIEW } from "@/application/dto/professional-billing-identity.dto";
import { makeGetMyBillingIdentityUseCase } from "@/application/use-cases/billing-identity/compose";
import { PageHeader } from "@/components/dashboard/page-header";
import { PageContainer } from "@/components/layout/page-container";
import { Section } from "@/components/layout/section";
import { Alert } from "@/components/ui/alert";
import { BillingIdentityForm } from "./billing-identity-form";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("professional.billing");
  return { title: t("metaTitle") };
}

/**
 * Module 146 — the professional's own billing-details page. Server-rendered from
 * the session user only; shows the safe view (never the admin note, reviewer or
 * revision). The state text makes explicit that saving does NOT verify the
 * details and that a verified identity must be re-reviewed after a change.
 */
export default async function ProfessionalBillingPage() {
  const user = await requireAuth();
  const [t, format] = await Promise.all([getTranslations("professional.billing"), getFormatter()]);

  let view = EMPTY_BILLING_IDENTITY_VIEW;
  let hasProfile = true;
  try {
    view = await makeGetMyBillingIdentityUseCase().execute(user.id);
  } catch (error) {
    if (!(error instanceof NotFoundError)) throw error;
    hasProfile = false;
  }

  if (!hasProfile) {
    return (
      <PageContainer gap="sm">
        <PageHeader title={t("title")} />
        <p className="text-sm text-foreground/70">
          {t.rich("noProfile", {
            link: (chunks) => (
              <Link href="/dashboard/professional" className="underline">
                {chunks}
              </Link>
            ),
          })}
        </p>
      </PageContainer>
    );
  }

  const variant = view.state === "VERIFIED" ? "success" : view.state === "NEEDS_CORRECTION" ? "danger" : "info";

  return (
    <PageContainer maxWidth="2xl">
      <PageHeader title={t("title")} subtitle={t("subtitle")} />

      <Section bordered gap="sm">
        <h2 className="text-base font-semibold">{t(`state.${view.state}.label`)}</h2>
        <Alert variant={variant} role="status">
          {t(`state.${view.state}.description`)}
        </Alert>
        {view.state === "VERIFIED" && view.verifiedAt && (
          <p className="text-sm text-foreground/70">
            {t("verifiedOn", { date: format.dateTime(new Date(view.verifiedAt), { dateStyle: "medium" }) })}
          </p>
        )}
        {view.state === "NEEDS_CORRECTION" && view.rejectionReason && (
          <p className="text-sm text-foreground/80">{t(`rejectionReason.${view.rejectionReason}`)}</p>
        )}
        <p className="text-sm text-foreground/70">{t("notVerificationNotice")}</p>
      </Section>

      <Section bordered gap="sm">
        <BillingIdentityForm details={view.details} hasVerifiedOrReviewed={view.state === "VERIFIED" || view.state === "NEEDS_CORRECTION"} />
      </Section>
    </PageContainer>
  );
}
