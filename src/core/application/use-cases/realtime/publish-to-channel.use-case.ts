import type { RealtimeHub } from "@/application/services/realtime/realtime-hub";

/**
 * Module 48 — Real-Time System (command).
 *
 * Publishes one event to a channel — the single write path used both by
 * domain-event subscribers (`broadcast-domain-event.subscriber.ts`) and
 * by the `RealTimeNotificationChannel` notification adapter, so "publish
 * to a channel" has exactly one implementation regardless of what
 * triggered it.
 */
export class PublishToChannelUseCase {
  constructor(private readonly hub: RealtimeHub) {}

  execute(input: { channel: string; type: string; payload: unknown }): { deliveredTo: number } {
    const deliveredTo = this.hub.publish(input.channel, input.type, input.payload);
    return { deliveredTo };
  }
}
