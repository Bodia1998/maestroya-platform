"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useTranslations } from "next-intl";

import type { LeadPurchaseCheckoutDTO } from "@/application/dto/lead-purchase-checkout.dto";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { buttonVariants } from "@/components/ui/button-variants";
import { Card } from "@/components/ui/card";
import { Spinner } from "@/components/ui/spinner";
import { cn } from "@/shared/utils/cn";
import { initiateLeadFeePaymentAction } from "../../payment-actions";
import { getLeadPurchaseCheckoutAction, startLeadPurchaseAction } from "./actions";
import { LeadSummaryCard, PurchaseSummaryCard, type CheckoutLeadSummary } from "./checkout-summary";
import { eligibilityGuidance, phaseFromPurchase, type CheckoutErrorKind, type EligibilityView, type CheckoutPhase, type CheckoutRetry } from "./checkout-view";
import { ContactReveal } from "./contact-reveal";
import { StripePaymentForm } from "./stripe-payment-form";
import { usePurchaseStatusPolling } from "./use-purchase-status-polling";

interface Props {
  leadId: string;
  /** The server's authoritative read of the caller's own purchase, or `undefined` if that read failed. */
  initialPurchase: LeadPurchaseCheckoutDTO | null | undefined;
  /** The contact-safe lead facts, or null when the lead cannot be shown (unavailable / not visible). */
  lead: CheckoutLeadSummary | null;
  /** Stripe's PUBLISHABLE key (public by design). The secret key never leaves the server. */
  stripePublishableKey: string;
  marketplaceHref: string;
  /** Module 147: display-only guidance from the server (null = unknown -> no banner; the server still enforces). */
  eligibility?: EligibilityView | null;
}

/**
 * Module 144 — the professional's purchase / checkout experience for ONE lead.
 *
 * Orchestration only. Every decision is the backend's:
 *   start purchase  -> existing M126/M135 initiation (idempotent, no price input)
 *   pay             -> existing M140 `initiateLeadFeePaymentAction` (amount from the persisted snapshot)
 *   card entry      -> Stripe Elements with the M140 client secret (publishable key only)
 *   confirmation    -> NEVER decided here: the page re-reads the authoritative status (bounded) while
 *                      M141's signature-verified webhook confirms the purchase
 *   contact         -> the existing M138 action, requested only after the server reports CONFIRMED
 *
 * Nothing in this component's state, the URL, storage or Stripe's responses can reveal contact or
 * mark the purchase paid. After a reload / return from a bank redirect the page starts over from
 * the server state, so a refresh never asks to pay twice and never loses a confirmed purchase.
 */
export function PurchaseCheckout({ leadId, initialPurchase, lead, stripePublishableKey, marketplaceHref, eligibility = null }: Props) {
  const t = useTranslations("professional.leadCheckout");

  const [purchase, setPurchase] = useState<LeadPurchaseCheckoutDTO | null>(initialPurchase ?? null);
  const [phase, setPhase] = useState<CheckoutPhase>(() =>
    initialPurchase === undefined ? { name: "error", kind: "network", retry: "refresh" } : phaseFromPurchase(initialPurchase, lead !== null),
  );
  const [pollRun, setPollRun] = useState(0);
  const busy = useRef(false);
  const autoPrepared = useRef(false);
  const headingRef = useRef<HTMLHeadingElement>(null);
  const firstRender = useRef(true);

  const phaseKey = phase.name === "error" ? `error:${phase.kind}` : phase.name;
  useEffect(() => {
    if (firstRender.current) {
      firstRender.current = false;
      return;
    }
    headingRef.current?.focus();
  }, [phaseKey]);

  /** Moves to the state the server reports. Never invents one. */
  const applyAuthoritative = useCallback(
    (next: LeadPurchaseCheckoutDTO | null) => {
      setPurchase(next);
      setPhase(phaseFromPurchase(next, lead !== null));
    },
    [lead],
  );

  const preparePayment = useCallback(
    async (purchaseId: string) => {
      if (busy.current) return;
      busy.current = true;
      setPhase({ name: "preparing" });
      try {
        const result = await initiateLeadFeePaymentAction(purchaseId);
        if (result.success) {
          const payment = result.payment;
          if (payment.paymentStatus === "SUCCEEDED" || payment.paymentStatus === "PROCESSING") {
            // Already paid / being processed (e.g. back from a bank redirect): just wait for the server.
            setPhase({ name: "awaiting" });
          } else if (payment.clientSecret) {
            setPhase({ name: "payment", clientSecret: payment.clientSecret });
          } else {
            setPhase({ name: "error", kind: "payment", retry: "prepare" });
          }
          return;
        }
        // Not payable (anymore) or provider problem: ask the server which, instead of guessing.
        const current = await getLeadPurchaseCheckoutAction(leadId);
        if (current.success && current.purchase && current.purchase.status !== "PENDING_PAYMENT") applyAuthoritative(current.purchase);
        else setPhase({ name: "error", kind: "payment", retry: "prepare" });
      } catch {
        setPhase({ name: "error", kind: "network", retry: "prepare" });
      } finally {
        busy.current = false;
      }
    },
    [leadId, applyAuthoritative],
  );

  // Resume: a PENDING_PAYMENT purchase continues to payment (M140 is idempotent per purchase).
  useEffect(() => {
    if (autoPrepared.current) return;
    if (initialPurchase?.status === "PENDING_PAYMENT") {
      autoPrepared.current = true;
      void preparePayment(initialPurchase.purchaseId);
    }
  }, [initialPurchase, preparePayment]);

  const startPurchase = useCallback(async () => {
    if (busy.current) return;
    busy.current = true;
    setPhase({ name: "starting" });
    let created: LeadPurchaseCheckoutDTO | null = null;
    try {
      const result = await startLeadPurchaseAction(leadId);
      if (!result.success) {
        setPhase({ name: "error", kind: "denied", retry: "start" });
        return;
      }
      created = result.purchase;
      setPurchase(created);
    } catch {
      setPhase({ name: "error", kind: "network", retry: "start" });
      return;
    } finally {
      busy.current = false;
    }
    if (created.status === "PENDING_PAYMENT") await preparePayment(created.purchaseId);
    else applyAuthoritative(created);
  }, [leadId, preparePayment, applyAuthoritative]);

  const refresh = useCallback(async () => {
    if (busy.current) return;
    busy.current = true;
    setPhase({ name: "starting" });
    try {
      const result = await getLeadPurchaseCheckoutAction(leadId);
      if (!result.success) {
        setPhase({ name: "error", kind: "network", retry: "refresh" });
        return;
      }
      const next = result.purchase;
      applyAuthoritative(next);
      if (next?.status === "PENDING_PAYMENT") {
        busy.current = false;
        await preparePayment(next.purchaseId);
      }
    } catch {
      setPhase({ name: "error", kind: "network", retry: "refresh" });
    } finally {
      busy.current = false;
    }
  }, [leadId, applyAuthoritative, preparePayment]);

  usePurchaseStatusPolling({
    active: phase.name === "awaiting",
    runKey: pollRun,
    leadId,
    onSettled: applyAuthoritative,
    onExhausted: () => setPhase({ name: "timeout" }),
  });

  function retry(kind: CheckoutRetry) {
    if (kind === "start") void startPurchase();
    else if (kind === "prepare" && purchase) void preparePayment(purchase.purchaseId);
    else void refresh();
  }

  // Module 147: guidance only. Disabling the buttons is a courtesy; the server rejects an ineligible start anyway.
  const blocked = eligibility !== null && !eligibility.eligible;
  const guidance = eligibility && !eligibility.eligible ? eligibilityGuidance(eligibility.reason) : null;

  const showWorking = phase.name === "starting" || phase.name === "preparing" || phase.name === "awaiting";
  const title =
    phase.name === "error" ? t(`status.error.${phase.kind}.title`) : t(`status.${phase.name}.title`);
  const description =
    phase.name === "error" ? t(`status.error.${phase.kind}.description`) : t(`status.${phase.name}.description`);

  return (
    <div className="grid grid-cols-1 gap-6 lg:grid-cols-[2fr_3fr]">
      <div className="flex flex-col gap-4">
        {lead && <LeadSummaryCard lead={lead} />}
        {phase.name !== "unavailable" && <PurchaseSummaryCard purchase={purchase} />}
        <div>
          <Link href={marketplaceHref} className={cn(buttonVariants({ variant: "outline", size: "sm" }))}>
            {t("actions.backToMarketplace")}
          </Link>
        </div>
      </div>

      <Card className="flex flex-col gap-4 p-5" aria-busy={showWorking}>
        <div className="flex flex-col gap-1">
          <h2 ref={headingRef} tabIndex={-1} className="text-lg font-semibold text-foreground outline-none">
            {title}
          </h2>
          <p role="status" aria-live="polite" className="flex items-center gap-2 text-sm text-muted-foreground">
            {showWorking && <Spinner size="sm" label={title} />}
            <span>{description}</span>
          </p>
        </div>

        {guidance && (phase.name === "review" || phase.name === "failed" || phase.name === "error") && (
          <Alert variant="warning">
            <p className="font-medium">{t("eligibility.title")}</p>
            <p>{t(`eligibility.reason.${guidance.reasonKey}`)}</p>
            <Link href={guidance.href} className={cn(buttonVariants({ variant: "outline", size: "sm" }), "mt-2")}>
              {t(`eligibility.cta.${guidance.ctaKey}`)}
            </Link>
          </Alert>
        )}

        {phase.name === "review" && (
          <div>
            <Button type="button" disabled={blocked} onClick={() => void startPurchase()}>
              {t("actions.start")}
            </Button>
          </div>
        )}

        {phase.name === "payment" && (
          <div className="flex flex-col gap-3">
            <p className="text-xs text-muted-foreground">{t("payment.secure")}</p>
            {stripePublishableKey ? (
              <StripePaymentForm publishableKey={stripePublishableKey} clientSecret={phase.clientSecret} onSubmitted={() => setPhase({ name: "awaiting" })} />
            ) : (
              <Alert variant="danger">{t("payment.unavailable")}</Alert>
            )}
          </div>
        )}

        {phase.name === "timeout" && (
          <div>
            <Button
              type="button"
              variant="outline"
              onClick={() => {
                setPollRun((n) => n + 1);
                setPhase({ name: "awaiting" });
              }}
            >
              {t("actions.checkAgain")}
            </Button>
          </div>
        )}

        {phase.name === "confirmed" && <ContactReveal leadId={leadId} />}

        {phase.name === "failed" && (
          <div>
            <Button type="button" variant="outline" disabled={blocked} onClick={() => void startPurchase()}>
              {t("actions.startNew")}
            </Button>
          </div>
        )}

        {phase.name === "error" && (
          <div>
            <Button type="button" variant="outline" onClick={() => retry(phase.retry)}>
              {t("actions.retry")}
            </Button>
          </div>
        )}
      </Card>
    </div>
  );
}

export type { CheckoutErrorKind };
