"use client";

import { useEffect } from "react";

import { markConversationReadAction } from "../actions";

/**
 * Fires MarkConversationReadUseCase once when this thread is opened, so the
 * unread badge on /messages clears without requiring an explicit "mark as
 * read" click. Renders nothing — purely a side-effect trigger, kept as its
 * own tiny Client Component so the rest of the page (including the message
 * list) can stay a Server Component.
 */
export function MarkReadOnView({ conversationId }: { conversationId: string }) {
  useEffect(() => {
    markConversationReadAction(conversationId);
  }, [conversationId]);

  return null;
}
