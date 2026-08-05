import Image from "next/image";
import { notFound } from "next/navigation";

import { NotFoundError } from "@/domain/errors/domain-error";
import { requireAuth } from "@/infrastructure/auth/rbac";
import { makeListConversationsUseCase, makeListMessagesUseCase } from "@/application/use-cases/chat/compose";
import { PageHeader } from "@/components/dashboard/page-header";
import { MarkReadOnView } from "./mark-read-on-view";
import { MessageComposer } from "./message-composer";
import { MessageBubble } from "./message-bubble";

export const metadata = { title: "Conversation" };

/**
 * Thread view for one Conversation the signed-in user belongs to.
 * ListMessagesUseCase re-verifies membership itself (see its doc comment) —
 * a conversationId belonging to someone else, or that doesn't exist,
 * surfaces as a plain 404, same "not yours vs. doesn't exist" convention as
 * every other detail page in this codebase.
 *
 * The conversation's own header info (other participant, request title)
 * comes from ListConversationsUseCase rather than a second repository
 * surface — this module deliberately doesn't add a "get one conversation's
 * display metadata" method only this page would ever call.
 */
export default async function ConversationPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const user = await requireAuth();

  let messages;
  try {
    messages = await makeListMessagesUseCase().execute(user.id, id);
  } catch (error) {
    if (error instanceof NotFoundError) notFound();
    throw error;
  }

  const conversations = await makeListConversationsUseCase().execute(user.id);
  const conversation = conversations.find((c) => c.id === id);
  if (!conversation) notFound();

  return (
    <div className="flex flex-col gap-4">
      <PageHeader
        title={conversation.otherParticipant.name ?? "Marketplace user"}
        subtitle={conversation.serviceRequestTitle}
        breadcrumbs={[{ label: "Messages", href: "/messages" }, { label: conversation.otherParticipant.name ?? "Conversation" }]}
        actions={
          conversation.otherParticipant.image ? (
            <Image
              src={conversation.otherParticipant.image}
              alt={conversation.otherParticipant.name ?? "Participant"}
              width={40}
              height={40}
              className="h-10 w-10 rounded-full object-cover"
            />
          ) : (
            <div className="h-10 w-10 rounded-full bg-black/10" aria-hidden="true" />
          )
        }
      />

      <MarkReadOnView conversationId={id} />

      <div className="flex flex-col gap-3">
        {messages.length === 0 ? (
          <p className="py-10 text-center text-sm text-foreground/60">
            No messages yet. Say hello to get things started.
          </p>
        ) : (
          messages.map((message) => (
            <MessageBubble
              key={message.id}
              message={message}
              conversationId={id}
              isOwn={message.senderId === user.id}
            />
          ))
        )}
      </div>

      {conversation.status === "ACTIVE" ? (
        <MessageComposer conversationId={id} />
      ) : (
        <p className="rounded-md border border-dashed border-border p-4 text-center text-sm text-foreground/60">
          This conversation is no longer open for new messages.
        </p>
      )}
    </div>
  );
}
