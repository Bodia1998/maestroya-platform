"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

import { cn } from "@/shared/utils/cn";
import type { MessageRecord } from "@/domain/repositories/message-repository";
import { deleteMessageAction } from "../actions";

/**
 * A single message bubble, aligned right for the caller's own messages and
 * left for the other participant's — the usual chat-UI convention. A
 * soft-deleted message (`status === "DELETED"`) renders as a muted
 * placeholder instead of its original body, matching most chat products
 * (see Message.deletedAt's doc comment in schema.prisma) — its ordering
 * slot in the conversation is preserved rather than the row vanishing.
 */
export function MessageBubble({
  message,
  conversationId,
  isOwn,
}: {
  message: MessageRecord;
  conversationId: string;
  isOwn: boolean;
}) {
  const router = useRouter();
  const [isDeleting, setIsDeleting] = useState(false);
  const [confirming, setConfirming] = useState(false);

  const isDeleted = message.status === "DELETED";

  async function handleDelete() {
    setIsDeleting(true);
    await deleteMessageAction(conversationId, message.id);
    setIsDeleting(false);
    setConfirming(false);
    router.refresh();
  }

  return (
    <div className={cn("flex flex-col gap-1", isOwn ? "items-end" : "items-start")}>
      <div
        className={cn(
          "max-w-[80%] rounded-md px-3 py-2 text-sm",
          isDeleted
            ? "italic text-foreground/50 bg-black/5"
            : isOwn
              ? "bg-primary text-primary-foreground"
              : "bg-black/5 text-foreground",
        )}
      >
        {isDeleted ? "This message was deleted." : message.body}
      </div>

      <div className="flex items-center gap-2 text-xs text-foreground/40">
        <span>{message.createdAt.toLocaleString()}</span>
        {isOwn && !isDeleted && (
          <>
            {confirming ? (
              <span className="flex items-center gap-1">
                <button
                  type="button"
                  disabled={isDeleting}
                  onClick={handleDelete}
                  className="text-red-600 hover:underline"
                >
                  {isDeleting ? "Deleting…" : "Confirm delete"}
                </button>
                <button type="button" onClick={() => setConfirming(false)} className="hover:underline">
                  Cancel
                </button>
              </span>
            ) : (
              <button type="button" onClick={() => setConfirming(true)} className="hover:underline">
                Delete
              </button>
            )}
          </>
        )}
      </div>
    </div>
  );
}
