"use client";

import { MapPin } from "lucide-react";
import { useFormatter, useTranslations } from "next-intl";

import type { LeadPurchaseCheckoutDTO } from "@/application/dto/lead-purchase-checkout.dto";
import type { RequestUrgencyValue } from "@/domain/repositories/service-request-repository";
import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import { formatBackendAmount } from "./checkout-view";

/** The contact-safe lead facts the page shows (a subset of the M124 preview; no contact, no customer id). */
export interface CheckoutLeadSummary {
  title: string;
  description: string;
  categoryLabel: string;
  urgency: RequestUrgencyValue;
  city: string;
  province: string | null;
}

export function LeadSummaryCard({ lead }: { lead: CheckoutLeadSummary }) {
  const t = useTranslations("professional.leadCheckout");
  const tRequests = useTranslations("professional.requests");
  return (
    <Card role="region" aria-labelledby="checkout-lead-heading" className="flex flex-col gap-3 p-4">
      <h2 id="checkout-lead-heading" className="text-sm font-medium text-muted-foreground">
        {t("lead.heading")}
      </h2>
      <div className="flex flex-wrap items-center gap-2">
        <Badge variant="secondary">{lead.categoryLabel}</Badge>
        <Badge variant="outline">{tRequests(`urgency.${lead.urgency}`)}</Badge>
      </div>
      <p className="text-base font-semibold text-foreground">{lead.title}</p>
      <p className="text-sm text-muted-foreground">{lead.description}</p>
      <p className="flex flex-wrap items-center gap-x-2 text-sm text-muted-foreground">
        <MapPin aria-hidden className="h-4 w-4 shrink-0" />
        <span>
          {lead.city}
          {lead.province ? `, ${lead.province}` : ""}
        </span>
      </p>
      <p className="text-xs text-muted-foreground">{t("lead.contactNote")}</p>
    </Card>
  );
}

/**
 * The financial breakdown of the purchase. Every figure is the persisted M135/M136 snapshot
 * string the server returned; they are formatted for display and nothing is added, multiplied
 * or subtracted here (IVA is NOT `total - fee` and NOT `fee * rate`).
 */
export function PurchaseSummaryCard({ purchase }: { purchase: LeadPurchaseCheckoutDTO | null }) {
  const t = useTranslations("professional.leadCheckout.summary");
  const format = useFormatter();

  return (
    <Card role="region" aria-labelledby="checkout-summary-heading" className="flex flex-col gap-3 p-4">
      <h2 id="checkout-summary-heading" className="text-sm font-medium text-muted-foreground">
        {t("heading")}
      </h2>
      {!purchase ? (
        <p className="text-sm text-muted-foreground">{t("pending")}</p>
      ) : purchase.taxAmount === null || purchase.totalAmount === null ? (
        <p className="text-sm text-muted-foreground">{t("unavailable")}</p>
      ) : (
        <dl className="grid grid-cols-[1fr_auto] gap-x-4 gap-y-2 text-sm">
          <dt className="text-muted-foreground">{t("fee")}</dt>
          <dd className="text-right text-foreground">{formatBackendAmount(format, purchase.feeAmount, purchase.currency)}</dd>
          <dt className="text-muted-foreground">{t("tax")}</dt>
          <dd className="text-right text-foreground">{formatBackendAmount(format, purchase.taxAmount, purchase.currency)}</dd>
          <dt className="border-t border-border pt-2 font-semibold text-foreground">{t("total")}</dt>
          <dd className="border-t border-border pt-2 text-right text-base font-semibold text-foreground">
            {formatBackendAmount(format, purchase.totalAmount, purchase.currency)}
          </dd>
        </dl>
      )}
    </Card>
  );
}
