"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

import { Button } from "@/components/ui/button";
import { acceptQuoteAction } from "./actions";

/**
 * Customer-facing "Accept this quote" action — same confirm-then-submit
 * pattern as WithdrawQuoteDialog/CancelServiceRequestDialog. Acceptance is
 * irreversible from the customer's side in this MVP (no un-accept), so this
 * gets the same explicit confirmation step as those other destructive/
 * final actions.
 */
export function AcceptQuoteDialog({ requestId, quoteId }: { requestId: string; quoteId: string }) {
  const router = useRouter();
  const [isOpen, setIsOpen] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [serverError, setServerError] = useState<string | null>(null);

  async function handleAccept() {
    setIsSubmitting(true);
    setServerError(null);
    const result = await acceptQuoteAction(requestId, quoteId);
    setIsSubmitting(false);

    if (!result.success) {
      setServerError(result.error);
      return;
    }
    setIsOpen(false);
    router.refresh();
  }

  if (!isOpen) {
    return (
      <Button type="button" onClick={() => setIsOpen(true)}>
        Accept this quote
      </Button>
    );
  }

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="accept-quote-title"
      className="flex flex-col gap-4 rounded-md border border-border bg-black/5 p-4"
    >
      <h3 id="accept-quote-title" className="text-sm font-semibold">
        Accept this quote?
      </h3>
      <p className="text-sm text-foreground/70">
        Every other quote for this request will be automatically declined. This cannot be undone.
      </p>

      {serverError && (
        <p role="alert" className="rounded-md bg-red-100 px-3 py-2 text-sm text-red-700">
          {serverError}
        </p>
      )}

      <div className="flex gap-2">
        <Button type="button" disabled={isSubmitting} onClick={handleAccept}>
          {isSubmitting ? "Accepting…" : "Yes, accept quote"}
        </Button>
        <Button type="button" variant="ghost" onClick={() => setIsOpen(false)}>
          Not yet
        </Button>
      </div>
    </div>
  );
}
