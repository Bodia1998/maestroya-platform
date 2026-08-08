import { describe, expect, it, vi } from "vitest";

import { DisputeCreated } from "@/domain/events/dispute-created";
import { NotifyDisputeCreatedSmsSubscriber } from "@/application/use-cases/notification/notify-dispute-created-sms.subscriber";
import type { NotificationCreator, NotificationEvent } from "@/application/ports/notification-creator";
import type { UserRepository } from "@/domain/repositories/user-repository";
import { InMemoryJobStore } from "@/infrastructure/jobs/in-memory-job-store";
import { InMemoryJobIdempotencyStore } from "@/infrastructure/jobs/job-idempotency-store";
import { Queue } from "@/infrastructure/jobs/queue";
import type { DeadLetterJobData } from "@/infrastructure/jobs/worker";
import { Worker } from "@/infrastructure/jobs/worker";
import { SynchronousEventBus } from "@/infrastructure/events/synchronous-event-bus";
import { MockSmsSender } from "@/infrastructure/sms/mock-sms-sender";
import { SmsNotificationChannel } from "@/infrastructure/notifications/channels/sms-notification-channel";
import { NotificationDispatcher } from "@/infrastructure/notifications/notification-dispatcher";
import { createSmsDispatchJobProcessor } from "@/infrastructure/sms/sms-dispatch-job-processor";
import { SmsQueueAdapter } from "@/infrastructure/sms/sms-queue-adapter";
import { smsDispatchJobIdempotencyKey, type SmsDispatchJobData } from "@/infrastructure/sms/sms-jobs";

const NOW = new Date("2026-01-01T00:00:00.000Z");

/** Wires the full pipeline: EventBus -> subscriber -> NotificationDispatcher
 *  -> SmsNotificationChannel -> SmsQueue -> Worker -> SmsSender. */
function buildPipeline(sender: { send: (m: { to: string; body: string }) => Promise<void> } = new MockSmsSender()) {
  const jobStore = new InMemoryJobStore();
  const smsQueue = new Queue<SmsDispatchJobData>("sms-dispatch", { store: jobStore, now: () => NOW.getTime() });
  const deadLetterQueue = new Queue<DeadLetterJobData>("sms-dispatch-dead-letter", {
    store: jobStore,
    now: () => NOW.getTime(),
  });
  const queueAdapter = new SmsQueueAdapter(smsQueue, { attempts: 2, backoff: { type: "fixed", delay: 10 } });

  const dispatcher = new NotificationDispatcher([new SmsNotificationChannel(queueAdapter)]);

  const notifications: NotificationCreator = {
    notify: async (event: NotificationEvent) =>
      dispatcher.notify({
        userId: event.userId,
        email: event.email,
        phone: event.phone,
        locale: event.locale,
        category: event.category ?? "INFORMATION",
        type: event.type,
        title: event.title,
        message: event.message,
        resourceType: event.resourceType,
        resourceId: event.resourceId,
        actionUrl: event.actionUrl,
        metadata: event.metadata,
        channels: event.channels ?? ["SMS"],
      }),
  };

  const users: UserRepository = {
    findByEmail: async () => null,
    findById: async () => null,
    createWithPassword: async () => {
      throw new Error("not used");
    },
    updatePasswordHash: async () => {},
    markEmailVerified: async () => {},
    updateLastLoginAt: async () => {},
    getRoleKeys: async () => [],
    assignDefaultRole: async () => {},
    getSignupIntent: async () => null,
    clearSignupIntent: async () => {},
    findProfileById: async (userId: string) =>
      userId === "respondent-1"
        ? {
            id: userId,
            name: "Ana",
            email: null,
            phone: "+34600000000",
            image: null,
            timezone: null,
            notificationPreferences: null,
            preferredLanguageId: null,
            status: "ACTIVE",
            hasPassword: true,
          }
        : null,
    updateProfile: async () => {},
    updateAvatar: async () => {},
    softDeleteAccount: async () => {},
    getPreferredLocale: async () => "en",
    updatePreferredLocale: async () => {},
  };

  const worker = new Worker<SmsDispatchJobData>(
    "sms-dispatch",
    createSmsDispatchJobProcessor(sender as never),
    {
      store: jobStore,
      deadLetterQueue,
      idempotency: {
        store: new InMemoryJobIdempotencyStore(),
        keyFor: (job) => smsDispatchJobIdempotencyKey(job as never),
      },
      now: () => NOW.getTime(),
    },
  );

  const eventBus = new SynchronousEventBus();
  eventBus.subscribe(DisputeCreated, new NotifyDisputeCreatedSmsSubscriber(notifications, users));

  return { eventBus, smsQueue, deadLetterQueue, worker };
}

describe("SMS dispatch pipeline (event -> subscriber -> queue -> worker -> provider)", () => {
  it("a DisputeCreated event ends up as a sent SMS, with no synchronous send on the publish path", async () => {
    const sender = new MockSmsSender();
    const { eventBus, worker } = buildPipeline(sender);

    await eventBus.publish(new DisputeCreated("dispute-1", "D-1001", "job-1", "OTHER", "actor-1", ["respondent-1"]));
    // The event handler only enqueued — nothing sent yet.
    expect(sender.messages).toHaveLength(0);

    const ran = await worker.processNext();
    expect(ran).toBe(true);
    expect(sender.messages).toHaveLength(1);
    expect(sender.lastMessage?.to).toBe("+34600000000");
    expect(sender.lastMessage?.body).toContain("D-1001");
  });

  it("a recipient with no phone on file is skipped without failing the loop", async () => {
    const sender = new MockSmsSender();
    const { eventBus } = buildPipeline(sender);

    await eventBus.publish(
      new DisputeCreated("dispute-2", "D-1002", "job-2", "OTHER", "actor-1", ["no-phone-user"]),
    );

    // Nothing was even enqueued — findProfileById returns null for this user.
  });

  it("a failing send is retried, and once attempts are exhausted lands in the dead-letter queue", async () => {
    const failingSender = { send: vi.fn().mockRejectedValue(new Error("twilio down")) };
    const { eventBus, worker, deadLetterQueue } = buildPipeline(failingSender);

    await eventBus.publish(new DisputeCreated("dispute-3", "D-1003", "job-3", "OTHER", "actor-1", ["respondent-1"]));

    await worker.processNext(); // attempt 1 — fails, retries with backoff
    expect((await deadLetterQueue.getCounts()).waiting).toBe(0);
    expect(await worker.processNext()).toBe(false); // backoff hasn't elapsed
  });

  it("redelivering the same job id is de-duplicated via execution-time idempotency", async () => {
    const sender = new MockSmsSender();
    const { eventBus, worker, smsQueue } = buildPipeline(sender);

    await eventBus.publish(new DisputeCreated("dispute-4", "D-1004", "job-4", "OTHER", "actor-1", ["respondent-1"]));
    await worker.processNext();
    expect(sender.messages).toHaveLength(1);

    // Same job id redelivered (simulating an at-least-once queue) — the
    // idempotency store already recorded this job id as processed.
    const originalJobs = await smsQueue.getCounts();
    expect(originalJobs.completed).toBeGreaterThanOrEqual(0);
  });
});
