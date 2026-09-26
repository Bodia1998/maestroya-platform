"use client";

import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";

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
  const t = useTranslations("customer.quotes.accept");

  return (
    <ConfirmDialog
      triggerLabel={t("trigger")}
      triggerVariant="default"
      title={t("title")}
      description={t("description")}
      confirmLabel={t("confirm")}
      pendingLabel={t("pending")}
      cancelLabel={t("cancel")}
      onConfirm={async () => {
        const result = await acceptQuoteAction(requestId, quoteId);
        if (result.success) router.refresh();
        return result;
      }}
    />
  );
}
