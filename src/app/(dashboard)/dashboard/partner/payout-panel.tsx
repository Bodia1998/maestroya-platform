"use client";

import { useState, useTransition } from "react";
import { useFormatter, useTranslations } from "next-intl";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Text } from "@/components/ui/typography";
import { requestAffiliatePayoutAction } from "./actions";

interface AffiliateBalanceSummaryView {
  availableBalance: number;
  reservedForPayout: number;
  pendingTotal: number;
  paidTotal: number;
  minimumPayoutThreshold: number;
  isEligibleForPayout: boolean;
  amountUntilEligible: number;
}

interface PayoutHistoryItem {
  id: string;
  amount: number;
  currency: string;
  status: string;
  reference: string | null;
  createdAt: Date;
  processedAt: Date | null;
}

const PAYOUT_STATUS_KEYS = ["PENDING", "PROCESSING", "PAID", "FAILED", "CANCELLED"] as const;
function isPayoutStatusKey(status: string): status is (typeof PAYOUT_STATUS_KEYS)[number] {
  return (PAYOUT_STATUS_KEYS as readonly string[]).includes(status);
}

function statusVariant(status: string): "default" | "secondary" | "success" | "warning" | "danger" | "outline" {
  switch (status) {
    case "PAID":
      return "success";
    case "PROCESSING":
      return "warning";
    case "FAILED":
      return "danger";
    case "CANCELLED":
      return "outline";
    default:
      return "secondary";
  }
}

/**
 * Module 100 — Affiliate Accumulated Balance & €50 Payout: the partner
 * dashboard's balance/threshold/eligibility panel and self-service
 * "Request payout" action.
 *
 * Every figure rendered here (`balance`) was computed server-side by
 * `GetAffiliateBalanceUseCase` from this partner's own id, resolved from
 * the authenticated session — never anything this component computes or
 * receives from a client-controllable source. Clicking "Request payout"
 * calls `requestAffiliatePayoutAction`, a Server Action that re-resolves
 * the partner id itself; this component never sends a partnerId, amount,
 * or eligibility flag to the server — there is nothing here for a
 * tampered request to manipulate.
 */
export function PayoutPanel({
  balance,
  payoutHistory,
}: {
  balance: AffiliateBalanceSummaryView;
  payoutHistory: PayoutHistoryItem[];
}) {
  const t = useTranslations("partner.payout");
  const format = useFormatter();
  const formatEuro = (amount: number) => format.number(amount, { style: "currency", currency: "EUR" });
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [justRequested, setJustRequested] = useState(false);

  function handleRequestPayout() {
    setError(null);
    setJustRequested(false);
    startTransition(async () => {
      const result = await requestAffiliatePayoutAction();
      if (!result.success) {
        setError(result.error);
        return;
      }
      setJustRequested(true);
    });
  }

  const progress = balance.minimumPayoutThreshold > 0 ? Math.min(1, balance.availableBalance / balance.minimumPayoutThreshold) : 0;

  return (
    <div className="flex flex-col gap-6">
      <Card>
        <CardHeader>
          <CardTitle>{t("balanceTitle")}</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-4">
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
            <div className="flex flex-col gap-1">
              <Text size="xs" tone="muted">
                {t("available")}
              </Text>
              <Text size="xl" weight="bold" tone="primary">
                {formatEuro(balance.availableBalance)}
              </Text>
            </div>
            <div className="flex flex-col gap-1">
              <Text size="xs" tone="muted">
                {t("reserved")}
              </Text>
              <Text size="xl" weight="bold">
                {formatEuro(balance.reservedForPayout)}
              </Text>
            </div>
            <div className="flex flex-col gap-1">
              <Text size="xs" tone="muted">
                {t("paidToDate")}
              </Text>
              <Text size="xl" weight="bold">
                {formatEuro(balance.paidTotal)}
              </Text>
            </div>
          </div>

          <div className="flex flex-col gap-2">
            <div className="flex items-center justify-between">
              <Text size="sm" tone="muted">
                {t("minimum", { amount: formatEuro(balance.minimumPayoutThreshold) })}
              </Text>
              {balance.isEligibleForPayout ? (
                <Badge variant="success">{t("eligible")}</Badge>
              ) : (
                <Badge variant="secondary">{t("moreNeeded", { amount: formatEuro(balance.amountUntilEligible) })}</Badge>
              )}
            </div>
            <div className="h-2 w-full overflow-hidden rounded-full bg-muted">
              <div className="h-full rounded-full bg-primary" style={{ width: `${Math.round(progress * 100)}%` }} />
            </div>
          </div>

          <div className="flex flex-col gap-2">
            <Button onClick={handleRequestPayout} disabled={!balance.isEligibleForPayout || isPending} className="self-start">
              {isPending ? t("requesting") : t("request")}
            </Button>
            {error && (
              <Text size="sm" tone="danger">
                {error}
              </Text>
            )}
            {justRequested && !error && (
              <Text size="sm" tone="muted">
                {t("requested")}
              </Text>
            )}
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>{t("historyTitle")}</CardTitle>
        </CardHeader>
        <CardContent>
          {payoutHistory.length === 0 ? (
            <Text size="sm" tone="muted">
              {t("empty")}
            </Text>
          ) : (
            <ul className="flex flex-col gap-3">
              {payoutHistory.map((p) => (
                <li key={p.id} className="flex items-center justify-between gap-4 text-sm">
                  <div className="flex flex-col">
                    <span className="font-medium">{formatEuro(p.amount)}</span>
                    <span className="text-muted-foreground text-xs">
                      {format.dateTime(new Date(p.createdAt), { dateStyle: "medium" })}
                      {p.reference ? ` · ${p.reference}` : ""}
                    </span>
                  </div>
                  <Badge variant={statusVariant(p.status)}>
                    {isPayoutStatusKey(p.status) ? t(`status.${p.status}`) : p.status}
                  </Badge>
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
