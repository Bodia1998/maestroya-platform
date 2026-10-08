"use client";

import { useRef, useState, type FormEvent } from "react";
import { useLocale, useTranslations } from "next-intl";
import { Elements, PaymentElement, useElements, useStripe } from "@stripe/react-stripe-js";
import { loadStripe, type Stripe, type StripeElementLocale } from "@stripe/stripe-js";

import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";

/** Locales Stripe Elements ships; anything else falls back to the browser's language. */
const STRIPE_LOCALES: Readonly<Record<string, StripeElementLocale>> = {
  cs: "cs",
  de: "de",
  en: "en",
  es: "es",
  fr: "fr",
  it: "it",
  nl: "nl",
  pl: "pl",
  pt: "pt",
  ro: "ro",
  ru: "ru",
};

const stripeCache = new Map<string, Promise<Stripe | null>>();

/** One Stripe.js instance per publishable key. Only the PUBLISHABLE key ever reaches the browser. */
function getStripe(publishableKey: string): Promise<Stripe | null> {
  let stripe = stripeCache.get(publishableKey);
  if (!stripe) {
    stripe = loadStripe(publishableKey);
    stripeCache.set(publishableKey, stripe);
  }
  return stripe;
}

interface Props {
  publishableKey: string;
  /** The PaymentIntent client secret returned by the existing M140 initiation. Never logged or stored. */
  clientSecret: string;
  /**
   * Called when Stripe accepted the submission (or is processing it). That is NOT a payment
   * confirmation: the parent must wait for the server to report CONFIRMED (Module 141).
   */
  onSubmitted: () => void;
}

/**
 * Module 144 — the Stripe Payment Element, using only the publishable key and the client secret.
 * The card data goes from Stripe's iframe straight to Stripe. The result of `confirmPayment`
 * is deliberately NOT used to mark anything as paid.
 */
export function StripePaymentForm({ publishableKey, clientSecret, onSubmitted }: Props) {
  const locale = useLocale();
  return (
    <Elements
      key={clientSecret}
      stripe={getStripe(publishableKey)}
      options={{ clientSecret, locale: STRIPE_LOCALES[locale] ?? "auto", appearance: { theme: "stripe" } }}
    >
      <PaymentFields onSubmitted={onSubmitted} />
    </Elements>
  );
}

function PaymentFields({ onSubmitted }: { onSubmitted: () => void }) {
  const t = useTranslations("professional.leadCheckout");
  const stripe = useStripe();
  const elements = useElements();
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<"declined" | "incomplete" | null>(null);
  const inFlight = useRef(false);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!stripe || !elements || inFlight.current) return;
    inFlight.current = true;
    setSubmitting(true);
    setError(null);
    try {
      const result = await stripe.confirmPayment({
        elements,
        // Used only if the bank requires a redirect (3-D Secure). The page ignores every query
        // parameter Stripe appends and re-reads the authoritative state from the server.
        confirmParams: { return_url: `${window.location.origin}${window.location.pathname}` },
        redirect: "if_required",
      });
      if (result.error) {
        setError(result.error.type === "validation_error" ? "incomplete" : "declined");
        return;
      }
      onSubmitted();
    } catch {
      setError("declined");
    } finally {
      inFlight.current = false;
      setSubmitting(false);
    }
  }

  return (
    <form onSubmit={handleSubmit} aria-label={t("payment.heading")} className="flex flex-col gap-4" noValidate>
      <PaymentElement />
      {error && <Alert variant="danger">{error === "incomplete" ? t("payment.incomplete") : t("payment.declined")}</Alert>}
      <div>
        <Button type="submit" disabled={!stripe || !elements || submitting} aria-busy={submitting}>
          {submitting ? t("actions.paying") : t("actions.pay")}
        </Button>
      </div>
    </form>
  );
}
