"use client";

import { MapPin } from "lucide-react";
import { useFormatter, useTranslations } from "next-intl";
import Link from "next/link";

import type { LeadFeedItemDTO } from "@/application/dto/lead-feed.dto";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { buttonVariants } from "@/components/ui/button-variants";
import { Card } from "@/components/ui/card";
import { cn } from "@/shared/utils/cn";
import { getLeadPurchaseHref } from "./lead-purchase-entry";

/**
 * Module 143 — one marketplace card. Renders ONLY the Module 134 contact-safe
 * feed item (explicit field reads, never a spread), so nothing outside that
 * whitelist can reach the DOM. The price is the snapshot string M134 returns:
 * it is formatted for display, never computed. The CTA only navigates to the
 * Module 144 entry (or is disabled while none exists); it performs no payment.
 */
export function LeadCard({ item, categoryLabel }: { item: LeadFeedItemDTO; categoryLabel: string }) {
  const t = useTranslations("professional.leads");
  const tRequests = useTranslations("professional.requests");
  const format = useFormatter();
  const purchaseHref = getLeadPurchaseHref(item.leadId);
  const headingId = `lead-${item.leadId}-title`;

  const numericPrice = Number(item.price);
  let price = `${item.price} ${item.currency}`;
  if (Number.isFinite(numericPrice)) {
    try {
      price = format.number(numericPrice, { style: "currency", currency: item.currency });
    } catch {
      // Unknown currency code: keep the plain snapshot string.
    }
  }

  return (
    <li>
      <Card role="article" aria-labelledby={headingId} className="flex h-full flex-col gap-3 p-4">
        <div className="flex flex-wrap items-center gap-2">
          <Badge variant="secondary">{categoryLabel}</Badge>
          <Badge variant="outline">{tRequests(`urgency.${item.urgency}`)}</Badge>
        </div>
        <h2 id={headingId} className="text-base font-semibold text-foreground">
          {item.title}
        </h2>
        <p className="line-clamp-4 text-sm text-muted-foreground">{item.description}</p>
        <p className="flex flex-wrap items-center gap-x-2 gap-y-1 text-sm text-muted-foreground">
          <MapPin aria-hidden className="h-4 w-4 shrink-0" />
          <span>
            {item.city}
            {item.province ? `, ${item.province}` : ""}
          </span>
          {item.distanceKm !== null && <span>· {tRequests("distance", { distance: item.distanceKm })}</span>}
        </p>
        <p className="text-xs text-muted-foreground">
          {t("card.posted", { date: format.dateTime(new Date(item.publishedAt), { dateStyle: "medium" }) })}
        </p>
        <div className="mt-auto flex flex-wrap items-end justify-between gap-2 border-t border-border pt-3">
          <dl>
            <dt className="text-xs text-muted-foreground">{t("card.priceLabel")}</dt>
            <dd className="text-base font-semibold text-foreground">{price}</dd>
          </dl>
          <p className="text-xs text-muted-foreground">{t("card.maxBuyers", { count: item.buyerPolicy.maxBuyers })}</p>
        </div>
        <p className="text-xs text-muted-foreground">{t("card.contactNote")}</p>
        {purchaseHref ? (
          <Link href={purchaseHref} className={cn(buttonVariants({ variant: "default", size: "sm" }), "w-full sm:w-auto")}>
            {t("cta.available")}
          </Link>
        ) : (
          <Button type="button" size="sm" variant="secondary" disabled aria-disabled="true" className="w-full sm:w-auto">
            {t("cta.unavailable")}
          </Button>
        )}
      </Card>
    </li>
  );
}
