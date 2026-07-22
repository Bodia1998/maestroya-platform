"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

import { Button } from "@/components/ui/button";
import { cancelServiceRequestAction } from "../actions";

export function CancelServiceRequestDialog({ requestId }: { requestId: string }) {
  const router = useRouter();
  const [isOpen, setIsOpen] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [serverError, setServerError] = useState<string | null>(null);

  async function handleCancel() {
    setIsSubmitting(true);
    setServerError(null);
    const result = await cancelServiceRequestAction(requestId);
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
        Cancel this request
      </Button>
    );
  }

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="cancel-request-title"
      className="flex flex-col gap-4 rounded-md border border-red-200 bg-red-50/50 p-4"
    >
      <h3 id="cancel-request-title" className="text-sm font-semibold text-red-700">
        Cancel this service request?
      </h3>
      <p className="text-sm text-foreground/70">
        Professionals will no longer be able to quote on it. This cannot be undone from here.
      </p>

      {serverError && (
        <p role="alert" className="rounded-md bg-red-100 px-3 py-2 text-sm text-red-700">
          {serverError}
        </p>
      )}

      <div className="flex gap-2">
        <Button type="button" variant="outline" disabled={isSubmitting} onClick={handleCancel}>
          {isSubmitting ? "Cancelling…" : "Yes, cancel request"}
        </Button>
        <Button type="button" variant="ghost" onClick={() => setIsOpen(false)}>
          Keep request
        </Button>
      </div>
    </div>
  );
}
