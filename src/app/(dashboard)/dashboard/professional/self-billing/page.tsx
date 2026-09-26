import type { Metadata } from "next";
import Link from "next/link";
import { getTranslations } from "next-intl/server";

import { requireAuth } from "@/infrastructure/auth/rbac";
import { makeGetMySelfBillingAuthorizationUseCase } from "@/application/use-cases/invoicing/compose";
import { PageHeader } from "@/components/dashboard/page-header";
import { PageContainer } from "@/components/layout/page-container";
import { Section } from "@/components/layout/section";
import { StatusBadge } from "@/components/dashboard/status-badge";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { grantMySelfBillingAuthorizationFormAction, revokeMySelfBillingAuthorizationFormAction } from "./actions";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("professional.selfBilling");
  return { title: t("metaTitle") };
}

/**
 * Module 99 — Self-Billing Authorization Entry Point & Financial Document
 * Access.
 *
 * This is the missing production entry point the audit/decision documents
 * identified: `GrantSelfBillingAuthorizationUseCase` (Module 79) existed
 * and worked, but no real page ever called it. This page is deliberately
 * minimal — status display, a Grant button, a Revoke button — per the
 * brief's Workstream D ("no large billing dashboard, no invented legal
 * agreement wording, no claim of qualified electronic signature").
 *
 * The text below describes what granting means in plain operational terms
 * only; it is not a legal agreement and does not claim to be one. The
 * actual acceptance record stores only a version label
 * (`CURRENT_SELF_BILLING_AGREEMENT_VERSION`, see
 * `self-billing-agreement.ts`'s own doc comment) — never legal wording.
 */
export default async function ProfessionalSelfBillingPage() {
  const user = await requireAuth();
  const authorization = await makeGetMySelfBillingAuthorizationUseCase().execute({ userId: user.id });

  const isActive = authorization?.status === "ACTIVE";
  const t = await getTranslations("professional.selfBilling");
  const statusKey = `status.${authorization?.status ?? ""}`;

  return (
    <PageContainer maxWidth="2xl" gap="sm">
      <PageHeader
        title={t("title")}
        subtitle={t("subtitle")}
      />

      <Section bordered gap="sm">
        <div className="flex items-center gap-3">
          {authorization ? (
            <StatusBadge
              status={authorization.status}
              label={t.has(statusKey as never) ? t(statusKey as never) : undefined}
            />
          ) : (
            <span className="rounded-full bg-black/5 px-2.5 py-0.5 text-xs font-medium text-foreground/70">
              {t("notAuthorized")}
            </span>
          )}
        </div>

        {isActive ? (
          <>
            <p className="text-sm text-foreground/80">
              {t("activeDescription")}
            </p>
            <form action={revokeMySelfBillingAuthorizationFormAction}>
              <Button type="submit" variant="outline">
                {t("revoke")}
              </Button>
            </form>
          </>
        ) : (
          <>
            <p className="text-sm text-foreground/80">
              {t("inactiveDescription")}
            </p>
            {authorization?.status === "REVOKED" && (
              <Alert variant="warning" title={t("previouslyRevokedTitle")}>
                <p>{t("previouslyRevokedDescription")}</p>
              </Alert>
            )}
            <form action={grantMySelfBillingAuthorizationFormAction}>
              <Button type="submit">{t("grant")}</Button>
            </form>
          </>
        )}
      </Section>

      <p className="text-xs text-foreground/60">
        {t.rich("viewInvoices", {
          link: (chunks) => (
            <Link href="/dashboard/professional/invoices" className="underline">
              {chunks}
            </Link>
          ),
        })}
      </p>
    </PageContainer>
  );
}
