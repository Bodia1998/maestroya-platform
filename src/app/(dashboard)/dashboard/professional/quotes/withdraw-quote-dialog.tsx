"use client";

import { useTranslations } from "next-intl";
import { useRouter } from "next/navigation";

import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { withdrawQuoteAction } from "./actions";

export function WithdrawQuoteDialog({ quoteId }: { quoteId: string }) {
  const t = useTranslations("professional.quotes.withdraw");
  const router = useRouter();

  return (
    <ConfirmDialog
      triggerLabel={t("trigger")}
      title={t("title")}
      description={t("description")}
      confirmLabel={t("confirm")}
      pendingLabel={t("pending")}
      cancelLabel={t("cancel")}
      destructive
      onConfirm={async () => {
        const result = await withdrawQuoteAction(quoteId);
        if (result.success) router.refresh();
        return result;
      }}
    />
  );
}
