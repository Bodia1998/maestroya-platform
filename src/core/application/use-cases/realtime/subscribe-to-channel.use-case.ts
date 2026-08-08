import type { RealtimeHub } from "@/application/services/realtime/realtime-hub";

/**
 * Module 48 — Real-Time System (command).
 *
 * Subscribes an already-connected client to one channel, enforcing
 * authorization via `RealtimeHub.subscribe` → `ChannelAuthorizationService`.
 * Thin by design — see `RealtimeHub`'s own doc comment for why the
 * orchestration logic lives there and not duplicated across every use
 * case in this directory.
 */
export class SubscribeToChannelUseCase {
  constructor(private readonly hub: RealtimeHub) {}

  async execute(input: { connectionId: string; channel: string }): Promise<{ channel: string }> {
    const channel = await this.hub.subscribe(input.connectionId, input.channel);
    return { channel: channel.toString() };
  }
}
