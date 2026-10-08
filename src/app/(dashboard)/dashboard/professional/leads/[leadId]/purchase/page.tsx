import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";

import { env } from "@/infrastructure/config/env";
import { requireAuth } from "@/infrastructure/auth/rbac";
import { makeListLeadRequestCategoriesUseCase } from "@/application/use-cases/lead-request/compose";
import { PageHeader } from "@/components/dashboard/page-header";
import { localizeCategoryName } from "@/presentation/i18n/service-categories";
import { getLeadPreviewAction } from "../../actions";
import { getLeadPurchaseCheckoutAction } from "./actions";
import type { CheckoutLeadSummary } from "./checkout-summary";
import { PurchaseCheckout } from "./purchase-checkout";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("professional.leadCheckout");
  return { title: t("metaTitle") };
}

/**
 * Module 144 — professional checkout for ONE LEAD_V1 lead.
 *
 * `[leadId]` is only a lookup key. Identity comes from the session (`requireAuth`, and again inside
 * every action); ownership is decided server-side by the existing use cases, which scope every
 * query by the session professional. The page renders the caller's own authoritative purchase state
 * (none / PENDING_PAYMENT / CONFIRMED / FAILED / CANCELLED), so a reload, a return from a bank
 * redirect or a re-opened tab always recovers from the backend. Query parameters (Stripe appends some
 * after a redirect) are deliberately ignored. No contact data is read here: it is requested by the
 * client from the M138 action only after the status is CONFIRMED.
 */
export default async function ProfessionalLeadPurchasePage({ params }: { params: Promise<{ leadId: string }> }) {
  await requireAuth();
  const { leadId } = await params;

  const [t, tServices, state, preview, categories] = await Promise.all([
    getTranslations("professional.leadCheckout"),
    getTranslations("services"),
    getLeadPurchaseCheckoutAction(leadId).catch(() => null),
    getLeadPreviewAction(leadId).catch(() => null),
    makeListLeadRequestCategoriesUseCase()
      .execute()
      .catch(() => []),
  ]);

  let lead: CheckoutLeadSummary | null = null;
  if (preview?.success) {
    const category = categories.find((c) => c.id === preview.lead.categoryId);
    lead = {
      title: preview.lead.title,
      description: preview.lead.description,
      categoryLabel: category ? localizeCategoryName(tServices, category) : preview.lead.categoryName,
      urgency: preview.lead.urgency,
      city: preview.lead.city,
      province: preview.lead.province,
    };
  }

  return (
    <div className="flex flex-col gap-6">
      <PageHeader title={t("title")} subtitle={t("subtitle")} />
      <PurchaseCheckout
        leadId={leadId}
        initialPurchase={state?.success ? state.purchase : undefined}
        lead={lead}
        stripePublishableKey={env.STRIPE_PUBLISHABLE_KEY}
        marketplaceHref="/dashboard/professional/leads"
      />
    </div>
  );
}
