"use client";

import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";

import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { cancelCompanyInvitationAction } from "./actions";

/** Cancelling an invitation previously submitted instantly on click (a
 *  plain `<form action={cancelCompanyInvitationFormAction}>`), the only
 *  action on this page without a confirmation step. Built on the shared
 *  `ConfirmDialog` (Module 30.5), calling the same
 *  `cancelCompanyInvitationAction` the old form action ultimately invoked. */
export function CancelInvitationButton({
  companyId,
  invitationId,
  email,
}: {
  companyId: string;
  invitationId: string;
  email: string;
}) {
  const router = useRouter();
  const t = useTranslations("company.invitations.cancel");

  return (
    <ConfirmDialog
      triggerLabel={t("trigger")}
      triggerVariant="outline"
      triggerClassName="h-8 text-xs"
      title={t("title")}
      description={t("description", { email })}
      confirmLabel={t("confirm")}
      pendingLabel={t("pending")}
      cancelLabel={t("keep")}
      destructive
      onConfirm={async () => {
        const result = await cancelCompanyInvitationAction(companyId, invitationId);
        if (result.success) router.refresh();
        return result;
      }}
    />
  );
}
