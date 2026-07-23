"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

import { Button } from "@/components/ui/button";
import { withdrawQuoteAction } from "./actions";

export function WithdrawQuoteDialog({ quoteId }: { quoteId: string }) {
  const router = useRouter();
  const [isOpen, setIsOpen] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [serverError, setServerError] = useState<string | null>(null);

  async function handleWithdraw() {
    setIsSubmitting(true);
    setServerError(null);
    const result = await withdrawQuoteAction(quoteId);
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
      <Button type="button" variant="outline" onClick={() => setIsOpen(true)}>
        Withdraw this quote
      </Button>
    );
  }

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="withdraw-quote-title"
      className="flex flex-col gap-4 rounded-md border border-red-200 bg-red-50/50 p-4"
    >
      <h3 id="withdraw-quote-title" className="text-sm font-semibold text-red-700">
        Withdraw this quote?
      </h3>
      <p className="text-sm text-foreground/70">
        The customer will no longer be able to accept it. This cannot be undone.
      </p>

      {serverError && (
        <p role="alert" className="rounded-md bg-red-100 px-3 py-2 text-sm text-red-700">
          {serverError}
        </p>
      )}

      <div className="flex gap-2">
        <Button type="button" variant="outline" disabled={isSubmitting} onClick={handleWithdraw}>
          {isSubmitting ? "Withdrawing…" : "Yes, withdraw quote"}
        </Button>
        <Button type="button" variant="ghost" onClick={() => setIsOpen(false)}>
          Keep quote
        </Button>
      </div>
    </div>
  );
}
