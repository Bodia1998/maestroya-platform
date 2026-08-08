import type { RealtimeHub } from "@/application/services/realtime/realtime-hub";

/** Module 48 — Real-Time System (command). Removes a channel subscription from an already-connected client. */
export class UnsubscribeFromChannelUseCase {
  constructor(private readonly hub: RealtimeHub) {}

  execute(input: { connectionId: string; channel: string }): void {
    this.hub.unsubscribe(input.connectionId, input.channel);
  }
}
