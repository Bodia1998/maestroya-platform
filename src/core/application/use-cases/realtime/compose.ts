import { eventBus } from "@/infrastructure/events/compose";
import { realtimeHub } from "@/infrastructure/realtime/compose";
import { RealtimeChannel } from "@/domain/value-objects/realtime-channel";
import { DisputeCreated } from "@/domain/events/dispute-created";
import { DisputeStatusChanged } from "@/domain/events/dispute-status-changed";
import { DisputeAssigned } from "@/domain/events/dispute-assigned";
import { DisputeMessageAdded } from "@/domain/events/dispute-message-added";
import { ServiceRequestUpdated } from "@/domain/events/service-request-updated";
import { PublishToChannelUseCase } from "@/application/use-cases/realtime/publish-to-channel.use-case";
import { SubscribeToChannelUseCase } from "@/application/use-cases/realtime/subscribe-to-channel.use-case";
import { UnsubscribeFromChannelUseCase } from "@/application/use-cases/realtime/unsubscribe-from-channel.use-case";
import { RecordHeartbeatUseCase } from "@/application/use-cases/realtime/record-heartbeat.use-case";
import { GetPresenceUseCase } from "@/application/use-cases/realtime/get-presence.use-case";
import { GetRealtimeHealthUseCase } from "@/application/use-cases/realtime/get-realtime-health.use-case";
import { getRealtimeHealth } from "@/infrastructure/realtime/compose";
import { BroadcastDomainEventSubscriber } from "@/application/use-cases/realtime/broadcast-domain-event.subscriber";

/**
 * Module 48 — Real-Time System.
 *
 * Composition root for the CQRS use cases and the domain-event → realtime
 * bridge — same manual-composition, module-load-time-registration
 * convention as every other subscribing module (`dispute/compose.ts`,
 * `notification/compose.ts`). Imported once from `instrumentation.ts`,
 * alongside the other subscriber-registering compose files.
 *
 * Registers a `BroadcastDomainEventSubscriber` per event this module
 * republishes onto a realtime channel. Deliberately not exhaustive over
 * every `DomainEvent` in the codebase — only events with an obvious
 * "thread"/resource channel a client would plausibly be subscribed to
 * (a dispute case, a service request) are wired here. Personal,
 * per-recipient notifications (bookings, chat, quotes, disputes, support
 * tickets, reviews, ...) already reach `user:{id}` channels through the
 * *existing* `NotificationCreator` → `NotificationDispatcher` →
 * `RealTimeNotificationChannel` path (see that class's doc comment and
 * `notification-service.ts`'s `channels` default) — bridging those same
 * events here too would double-publish the same fact on two channels for
 * no additional information. See docs/MODULE_48_REALTIME_SYSTEM.md,
 * "Event flow", for the full picture of both paths.
 */
const publishToChannel = new PublishToChannelUseCase(realtimeHub);

eventBus.subscribe(
  DisputeCreated,
  new BroadcastDomainEventSubscriber(publishToChannel, (event) => ({
    channel: RealtimeChannel.of("dispute", event.disputeId).toString(),
    type: "dispute.created",
    payload: { disputeId: event.disputeId, caseNumber: event.caseNumber, reason: event.reason },
  })),
);

eventBus.subscribe(
  DisputeStatusChanged,
  new BroadcastDomainEventSubscriber(publishToChannel, (event) => ({
    channel: RealtimeChannel.of("dispute", event.disputeId).toString(),
    type: "dispute.status-changed",
    payload: { disputeId: event.disputeId, previousStatus: event.previousStatus, newStatus: event.newStatus, transition: event.transition },
  })),
);

eventBus.subscribe(
  DisputeAssigned,
  new BroadcastDomainEventSubscriber(publishToChannel, (event) => ({
    channel: RealtimeChannel.of("dispute", event.disputeId).toString(),
    type: "dispute.assigned",
    payload: { disputeId: event.disputeId, newAssigneeUserId: event.newAssigneeUserId },
  })),
);

eventBus.subscribe(
  DisputeMessageAdded,
  new BroadcastDomainEventSubscriber(publishToChannel, (event) => ({
    channel: RealtimeChannel.of("dispute", event.disputeId).toString(),
    type: "dispute.message-added",
    payload: { disputeId: event.disputeId, messageId: event.messageId, actorUserId: event.actorUserId },
  })),
);

eventBus.subscribe(
  ServiceRequestUpdated,
  new BroadcastDomainEventSubscriber(publishToChannel, (event) => ({
    channel: RealtimeChannel.of("service-request", event.serviceRequestId).toString(),
    type: "service-request.updated",
    payload: { serviceRequestId: event.serviceRequestId, status: event.status },
  })),
);

export function makeSubscribeToChannelUseCase(): SubscribeToChannelUseCase {
  return new SubscribeToChannelUseCase(realtimeHub);
}

export function makeUnsubscribeFromChannelUseCase(): UnsubscribeFromChannelUseCase {
  return new UnsubscribeFromChannelUseCase(realtimeHub);
}

export function makePublishToChannelUseCase(): PublishToChannelUseCase {
  return publishToChannel;
}

export function makeRecordHeartbeatUseCase(): RecordHeartbeatUseCase {
  return new RecordHeartbeatUseCase(realtimeHub);
}

export function makeGetPresenceUseCase(): GetPresenceUseCase {
  return new GetPresenceUseCase(realtimeHub);
}

export function makeGetRealtimeHealthUseCase(): GetRealtimeHealthUseCase {
  return new GetRealtimeHealthUseCase(getRealtimeHealth);
}
