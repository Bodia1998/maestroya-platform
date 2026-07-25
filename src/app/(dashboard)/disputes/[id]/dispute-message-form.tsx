"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

import { Button } from "@/components/ui/button";
import { addDisputeMessageAction } from "../actions";

/** Module 21 — Disputes & Support: minimal message-composer for a
 *  dispute's thread — mirrors JobActions/CancelJobDialog's client-form
 *  pattern (see job-actions.tsx). */
export function DisputeMessageForm({ disputeId }: { disputeId: string }) {
  const router = useRouter();
  const [body, setBody] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit() {
    if (body.trim().length === 0) return;
    setIsSubmitting(true);
    setError(null);
    const result = await addDisputeMessageAction(disputeId, body);
    setIsSubmitting(false);
    if (!result.success) {
      setError(result.error);
      return;
    }
    setBody("");
    router.refresh();
  }

  return (
    <div className="flex flex-col gap-2">
      <textarea
        value={body}
        onChange={(e) => setBody(e.target.value)}
        rows={3}
        placeholder="Write a message…"
        className="rounded-md border border-border px-3 py-2 text-sm"
      />
      {error && (
        <p role="alert" className="rounded-md bg-red-100 px-3 py-2 text-sm text-red-700">
          {error}
        </p>
      )}
      <Button type="button" disabled={isSubmitting} onClick={handleSubmit}>
        {isSubmitting ? "Sending…" : "Send message"}
      </Button>
    </div>
  );
}
