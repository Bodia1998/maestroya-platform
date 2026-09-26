"use client";

import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";

import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { cancelServiceRequestAction } from "../actions";

export function CancelServiceRequestDialog({ requestId }: { requestId: string }) {
  const router = useRouter();
  const t = useTranslations("customer.requests.cancel");

  return (
    <ConfirmDialog
      triggerLabel={t("trigger")}
      title={t("title")}
      description={t("description")}
      confirmLabel={t("confirm")}
      pendingLabel={t("pending")}
      cancelLabel={t("keep")}
      destructive
      onConfirm={async () => {
        const result = await cancelServiceRequestAction(requestId);
        if (result.success) router.refresh();
        return result;
      }}
    />
  );
}
