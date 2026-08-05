"use client";

import { useRouter } from "next/navigation";

import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { acceptQuoteAction } from "./actions";

/**
 * Customer-facing "Accept this quote" action — same confirm-then-submit
 * pattern as WithdrawQuoteDialog/CancelServiceRequestDialog, now built on
 * the shared `ConfirmDialog`. Acceptance is irreversible from the
 * customer's side in this MVP (no un-accept), so this gets the same
 * explicit confirmation step as those other destructive/final actions.
 */
export function AcceptQuoteDialog({ requestId, quoteId }: { requestId: string; quoteId: string }) {
  const router = useRouter();

  return (
    <ConfirmDialog
      triggerLabel="Accept this quote"
      triggerVariant="default"
      title="Accept this quote?"
      description="Every other quote for this request will be automatically declined. This cannot be undone."
      confirmLabel="Yes, accept quote"
      pendingLabel="Accepting…"
      cancelLabel="Not yet"
      onConfirm={async () => {
        const result = await acceptQuoteAction(requestId, quoteId);
        if (result.success) router.refresh();
        return result;
      }}
    />
  );
}
