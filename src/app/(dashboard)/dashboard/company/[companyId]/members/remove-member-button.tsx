"use client";

import { useRouter } from "next/navigation";

import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { removeCompanyMemberAction } from "./actions";

/**
 * Module 18 — Company Professional: removing a member previously submitted
 * instantly on click (a plain `<form action={removeCompanyMemberFormAction}>`
 * with no confirmation step at all) — the only destructive action on this
 * page without one, unlike account deletion/professional deactivation
 * elsewhere. Built on the shared `ConfirmDialog` (Module 30.5), calling the
 * same `removeCompanyMemberAction` the old form action ultimately invoked —
 * `canRemoveMember` authorization is still fully re-checked server-side
 * inside it regardless of this confirmation step.
 */
export function RemoveMemberButton({
  companyId,
  memberId,
  memberLabel,
}: {
  companyId: string;
  memberId: string;
  memberLabel: string;
}) {
  const router = useRouter();

  return (
    <ConfirmDialog
      triggerLabel="Remove"
      triggerVariant="outline"
      triggerClassName="h-9 text-xs"
      title={`Remove ${memberLabel}?`}
      description="They will immediately lose access to this company account. This cannot be undone from here."
      confirmLabel="Yes, remove"
      pendingLabel="Removing…"
      destructive
      onConfirm={async () => {
        const result = await removeCompanyMemberAction(companyId, memberId);
        if (result.success) router.refresh();
        return result;
      }}
    />
  );
}
