"use client";

import { useRouter } from "next/navigation";

import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { cancelServiceRequestAction } from "../actions";

export function CancelServiceRequestDialog({ requestId }: { requestId: string }) {
  const router = useRouter();

  return (
    <ConfirmDialog
      triggerLabel="Cancel this request"
      title="Cancel this service request?"
      description="Professionals will no longer be able to quote on it. This cannot be undone from here."
      confirmLabel="Yes, cancel request"
      pendingLabel="Cancelling…"
      cancelLabel="Keep request"
      destructive
      onConfirm={async () => {
        const result = await cancelServiceRequestAction(requestId);
        if (result.success) router.refresh();
        return result;
      }}
    />
  );
}
