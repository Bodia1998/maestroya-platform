"use client";

import { useRouter } from "next/navigation";

import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { withdrawQuoteAction } from "./actions";

export function WithdrawQuoteDialog({ quoteId }: { quoteId: string }) {
  const router = useRouter();

  return (
    <ConfirmDialog
      triggerLabel="Withdraw this quote"
      title="Withdraw this quote?"
      description="The customer will no longer be able to accept it. This cannot be undone."
      confirmLabel="Yes, withdraw quote"
      pendingLabel="Withdrawing…"
      cancelLabel="Keep quote"
      destructive
      onConfirm={async () => {
        const result = await withdrawQuoteAction(quoteId);
        if (result.success) router.refresh();
        return result;
      }}
    />
  );
}
