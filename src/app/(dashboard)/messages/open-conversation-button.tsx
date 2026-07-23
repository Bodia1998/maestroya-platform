"use client";

import { useState, useTransition } from "react";

import { Button } from "@/components/ui/button";
import { openConversationAction } from "./actions";

/**
 * Entry point into Chat from a ServiceRequest/Quote page — used by both the
 * customer's "received quotes" list (with `professionalProfileId` set, to
 * pick which professional to message) and a professional's own quote detail
 * page (with no `professionalProfileId`, since there's only one customer to
 * resolve to). See OpenConversationUseCase for the full eligibility rule
 * this button's action re-verifies server-side.
 *
 * `next/navigation`'s `redirect()` inside a Server Action thrown from a
 * transition surfaces as a normal navigation, not an error — no explicit
 * `router.push` needed on success. Only the failure path needs local state.
 */
export function OpenConversationButton({
  serviceRequestId,
  professionalProfileId,
  label = "Message",
}: {
  serviceRequestId: string;
  professionalProfileId?: string;
  label?: string;
}) {
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  function handleClick() {
    setError(null);
    startTransition(async () => {
      // A successful call never actually returns here — openConversationAction
      // redirects via a thrown Next.js control-flow signal on success, so
      // only a failure ActionResult is ever received by this line.
      const result = await openConversationAction(serviceRequestId, professionalProfileId);
      if (!result.success) {
        setError(result.error);
      }
    });
  }

  return (
    <div className="flex flex-col gap-1">
      <Button type="button" variant="outline" disabled={isPending} onClick={handleClick}>
        {isPending ? "Opening…" : label}
      </Button>
      {error && (
        <p role="alert" className="text-xs text-red-700">
          {error}
        </p>
      )}
    </div>
  );
}
