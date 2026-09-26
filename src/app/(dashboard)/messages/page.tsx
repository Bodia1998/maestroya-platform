import Image from "next/image";
import Link from "next/link";
import { MessageSquare } from "lucide-react";
import { getFormatter, getTranslations } from "next-intl/server";

import { requireAuth } from "@/infrastructure/auth/rbac";
import { makeListConversationsUseCase } from "@/application/use-cases/chat/compose";
import { PageHeader } from "@/components/dashboard/page-header";
import { Card } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { PageContainer } from "@/components/layout/page-container";

export async function generateMetadata() {
  const t = await getTranslations("customer.messages");
  return { title: t("title") };
}

/**
 * Inbox view: every conversation the signed-in user (customer or
 * professional side) currently belongs to, newest activity first.
 * ListConversationsUseCase is inherently scoped to the caller — there is no
 * id parameter to have gotten wrong, so there's nothing here to authorize
 * beyond "is someone signed in."
 */
export default async function MessagesPage() {
  const user = await requireAuth();
  const [conversations, t, format] = await Promise.all([
    makeListConversationsUseCase().execute(user.id),
    getTranslations("customer.messages"),
    getFormatter(),
  ]);

  return (
    <PageContainer gap="sm">
      <PageHeader title={t("title")} />

      {conversations.length === 0 ? (
        <EmptyState
          icon={MessageSquare}
          title={t("empty.title")}
          description={t("empty.description")}
        />
      ) : (
        <Card className="overflow-hidden p-0 shadow-sm">
          <ul className="flex flex-col divide-y divide-border">
          {conversations.map((conversation) => (
            <li key={conversation.id}>
              <Link
                href={`/messages/${conversation.id}`}
                className="flex items-center gap-3 p-4 outline-none transition-colors hover:bg-muted focus-visible:bg-muted"
              >
                {conversation.otherParticipant.image ? (
                  <Image
                    src={conversation.otherParticipant.image}
                    alt={conversation.otherParticipant.name ?? t("participant")}
                    width={40}
                    height={40}
                    className="h-10 w-10 shrink-0 rounded-full object-cover"
                  />
                ) : (
                  <div className="h-10 w-10 shrink-0 rounded-full bg-black/10" aria-hidden="true" />
                )}

                <div className="min-w-0 flex-1">
                  <div className="flex items-center justify-between gap-2">
                    <p className="truncate font-medium">
                      {conversation.otherParticipant.name ?? t("unknownParticipant")}
                    </p>
                    {conversation.lastMessageAt && (
                      <span className="shrink-0 text-xs text-foreground/50">
                        {format.dateTime(conversation.lastMessageAt, { dateStyle: "medium" })}
                      </span>
                    )}
                  </div>
                  <p className="truncate text-xs text-foreground/60">{conversation.serviceRequestTitle}</p>
                  <p className="truncate text-sm text-foreground/70">
                    {conversation.lastMessagePreview ?? t("noMessagesYet")}
                  </p>
                </div>

                {conversation.unreadCount > 0 && (
                  <span className="ml-2 inline-flex h-5 min-w-5 shrink-0 items-center justify-center rounded-full bg-primary px-1.5 text-xs font-medium text-primary-foreground">
                    {conversation.unreadCount}
                  </span>
                )}
              </Link>
            </li>
          ))}
          </ul>
        </Card>
      )}
    </PageContainer>
  );
}
