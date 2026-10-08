"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useTranslations } from "next-intl";

import type { LeadContactDTO } from "@/application/dto/lead-contact.dto";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Spinner } from "@/components/ui/spinner";
import { getLeadContactAction } from "../../actions";

type ContactState = { kind: "loading" } | { kind: "loaded"; contact: LeadContactDTO } | { kind: "error"; denied: boolean };

/**
 * Module 144 — shows the customer's contact for a purchase the server has reported CONFIRMED.
 *
 * This component is rendered ONLY after an authoritative CONFIRMED read, but that is not what
 * protects the data: the contact comes from the existing Module 138 action, which re-checks the
 * session professional's own CONFIRMED purchase for this lead on every call and answers the same
 * generic denial otherwise. Nothing here is taken from a URL, storage, Stripe or local state.
 * It renders the M138 DTO's existing fields as returned (no extra personal data).
 */
export function ContactReveal({ leadId }: { leadId: string }) {
  const t = useTranslations("professional.leadCheckout.contact");
  const [state, setState] = useState<ContactState>({ kind: "loading" });
  const inFlight = useRef(false);

  const load = useCallback(async () => {
    if (inFlight.current) return;
    inFlight.current = true;
    setState({ kind: "loading" });
    try {
      const result = await getLeadContactAction(leadId);
      setState(result.success ? { kind: "loaded", contact: result.contact } : { kind: "error", denied: true });
    } catch {
      setState({ kind: "error", denied: false });
    } finally {
      inFlight.current = false;
    }
  }, [leadId]);

  useEffect(() => {
    void load();
  }, [load]);

  if (state.kind === "loading") {
    return (
      <div role="status" aria-busy="true" aria-live="polite" className="flex items-center gap-2 text-sm text-muted-foreground">
        <Spinner size="sm" label={t("loading")} />
        <span aria-hidden>{t("loading")}</span>
      </div>
    );
  }

  if (state.kind === "error") {
    return (
      <div className="flex flex-col gap-3">
        <Alert variant="danger">{state.denied ? t("denied") : t("error")}</Alert>
        {!state.denied && (
          <div>
            <Button type="button" variant="outline" size="sm" onClick={() => void load()}>
              {t("retry")}
            </Button>
          </div>
        )}
      </div>
    );
  }

  const { contact } = state;
  const address = contact.address;
  const notProvided = t("notProvided");
  return (
    <section aria-labelledby="lead-contact-heading" className="flex flex-col gap-3">
      <h3 id="lead-contact-heading" className="text-base font-semibold text-foreground">
        {t("heading")}
      </h3>
      <dl className="grid grid-cols-1 gap-3 text-sm sm:grid-cols-[max-content_1fr]">
        <dt className="text-muted-foreground">{t("name")}</dt>
        <dd className="text-foreground">{contact.customerDisplayName ?? notProvided}</dd>
        <dt className="text-muted-foreground">{t("email")}</dt>
        <dd className="break-all text-foreground">{contact.email ? <a className="underline" href={`mailto:${contact.email}`}>{contact.email}</a> : notProvided}</dd>
        <dt className="text-muted-foreground">{t("phone")}</dt>
        <dd className="text-foreground">{contact.phone ? <a className="underline" href={`tel:${contact.phone}`}>{contact.phone}</a> : notProvided}</dd>
        <dt className="text-muted-foreground">{t("address")}</dt>
        <dd className="text-foreground">
          <address className="not-italic">
            <span className="block">{address.line1}</span>
            {address.line2 && <span className="block">{address.line2}</span>}
            <span className="block">
              {address.postalCode} {address.city}
              {address.province ? `, ${address.province}` : ""}
            </span>
          </address>
        </dd>
      </dl>
    </section>
  );
}
