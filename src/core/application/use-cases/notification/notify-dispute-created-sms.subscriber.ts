import type { DisputeCreated } from "@/domain/events/dispute-created";
import type { EventHandler } from "@/application/ports/event-bus";
import type { NotificationCreator } from "@/application/ports/notification-creator";
import type { UserRepository } from "@/domain/repositories/user-repository";

/**
 * Module 49 — SMS Notifications.
 *
 * The `SMS`-only counterpart to `NotifyDisputeCreatedSubscriber`
 * (`notify-dispute-created.subscriber.ts`) — registered as a **second,
 * independent** handler for the same `DisputeCreated` event, exactly the
 * multi-handler-per-event capability `EventBus.subscribe`'s own doc
 * comment documents ("Multiple handlers may subscribe to the same event
 * type; all of them run, in subscription order"). This is deliberately a
 * new file and a new registration rather than an edit to the existing
 * `NotifyDisputeCreatedSubscriber`/its `IN_APP`+`REALTIME` registration in
 * `notification/compose.ts`: it keeps that class, its existing unit test,
 * and its established `IN_APP`+`REALTIME` behavior completely untouched,
 * while still flowing SMS through the identical domain-event pipeline
 * every other notification channel already uses — never a direct call
 * from `CreateDisputeUseCase`.
 *
 * A dispute being opened is this codebase's best-fit existing domain
 * event for `DisputeNotification` (see
 * `infrastructure/sms/sms-template-mapping.ts`): time-sensitive, requires
 * a response, and exactly the kind of update a recipient benefits from
 * being told about even when they are not actively looking at the app —
 * unlike, say, `ReviewCreated`, deliberately left SMS-silent here.
 *
 * Resolves the recipient's phone number and locale via `UserRepository`
 * (`findProfileById`/`getPreferredLocale`) — this subscriber, unlike its
 * `IN_APP`/`REALTIME` sibling, needs a phone number the event itself does
 * not carry. A recipient with no phone on file, or whose profile lookup
 * fails, is skipped rather than failing the loop for every other
 * recipient: `SmsNotificationChannel` already treats a missing phone as a
 * safe no-op (see that class's own doc comment), and a profile lookup
 * failure here degrades to the same outcome by design — this must never
 * be the thing that breaks in-app/realtime delivery for a dispute event.
 */
export class NotifyDisputeCreatedSmsSubscriber implements EventHandler<DisputeCreated> {
  constructor(
    private readonly notifications: NotificationCreator,
    private readonly users: UserRepository,
  ) {}

  async handle(event: DisputeCreated): Promise<void> {
    for (const respondentUserId of event.recipientUserIds) {
      const [profile, locale] = await Promise.all([
        this.safeFindProfile(respondentUserId),
        this.safeGetLocale(respondentUserId),
      ]);

      if (!profile?.phone) continue;

      await this.notifications.notify({
        userId: respondentUserId,
        type: "DISPUTE_CREATED",
        title: "A dispute was opened",
        message: `A dispute (${event.caseNumber}) was opened regarding your job.`,
        resourceType: "DISPUTE",
        resourceId: event.disputeId,
        actionUrl: `/disputes/${event.disputeId}`,
        metadata: { jobId: event.jobId, caseNumber: event.caseNumber },
        phone: profile.phone,
        locale,
        channels: ["SMS"],
      });
    }
  }

  private async safeFindProfile(userId: string) {
    try {
      return await this.users.findProfileById(userId);
    } catch {
      return null;
    }
  }

  private async safeGetLocale(userId: string): Promise<string | null> {
    try {
      return await this.users.getPreferredLocale(userId);
    } catch {
      return null;
    }
  }
}
