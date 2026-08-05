"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
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
      <Label htmlFor="dispute-message-body" className="sr-only">
        Write a message
      </Label>
      <Textarea
        id="dispute-message-body"
        value={body}
        onChange={(e) => setBody(e.target.value)}
        rows={3}
        placeholder="Write a message…"
      />
      {error && (
        <Alert variant="danger" role="alert">
          {error}
        </Alert>
      )}
      <Button type="button" disabled={isSubmitting} onClick={handleSubmit} className="w-full sm:w-auto">
        {isSubmitting ? "Sending…" : "Send message"}
      </Button>
    </div>
  );
}
