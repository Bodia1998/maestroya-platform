"use client";

import { useRouter } from "next/navigation";
import { useRef, useState } from "react";

import { Button } from "@/components/ui/button";
import { MAX_MESSAGE_LENGTH } from "@/application/dto/chat.dto";
import { sendMessageAction } from "../actions";

/**
 * Message composer for a Conversation. A plain progressively-enhanced form
 * (Server Action via `action={}`) would also work, but this is a
 * client-driven submit so the textarea can be cleared and the message list
 * refreshed without a full navigation, matching the interactive feel a chat
 * composer needs. Errors surface inline instead of navigating to an error
 * page — a failed send should never lose the user's drafted text.
 */
export function MessageComposer({ conversationId }: { conversationId: string }) {
  const router = useRouter();
  const formRef = useRef<HTMLFormElement>(null);
  const [body, setBody] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(formData: FormData) {
    if (!body.trim()) return;

    setIsSubmitting(true);
    setError(null);
    const result = await sendMessageAction(formData);
    setIsSubmitting(false);

    if (!result.success) {
      setError(result.error);
      return;
    }
    setBody("");
    formRef.current?.reset();
    router.refresh();
  }

  return (
    <form ref={formRef} action={handleSubmit} className="flex flex-col gap-2 border-t border-border pt-4">
      <input type="hidden" name="conversationId" value={conversationId} />

      {error && (
        <p role="alert" className="rounded-md bg-red-100 px-3 py-2 text-sm text-red-700">
          {error}
        </p>
      )}

      <div className="flex items-end gap-2">
        <textarea
          name="body"
          value={body}
          onChange={(e) => setBody(e.target.value)}
          maxLength={MAX_MESSAGE_LENGTH}
          rows={2}
          disabled={isSubmitting}
          placeholder="Write a message…"
          aria-label="Message"
          className="min-h-10 flex-1 resize-none rounded-md border border-border bg-transparent px-3 py-2 text-sm focus-visible:outline-none focus-visible:ring-2"
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault();
              formRef.current?.requestSubmit();
            }
          }}
        />
        <Button type="submit" disabled={isSubmitting || !body.trim()}>
          {isSubmitting ? "Sending…" : "Send"}
        </Button>
      </div>
    </form>
  );
}
