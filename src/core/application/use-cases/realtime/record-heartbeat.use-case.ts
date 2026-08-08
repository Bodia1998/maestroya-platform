import { ValidationError } from "@/domain/errors/domain-error";
import type { RealtimeHub } from "@/application/services/realtime/realtime-hub";

/** Module 48 — Real-Time System (command). Refreshes a connection's liveness timestamp — called on every SSE/WebSocket heartbeat frame so `RealtimeHub.reapExpired` never evicts a client that is still actually connected. */
export class RecordHeartbeatUseCase {
  constructor(private readonly hub: RealtimeHub) {}

  execute(input: { connectionId: string }): void {
    const ok = this.hub.heartbeat(input.connectionId);
    if (!ok) {
      throw new ValidationError(`No active realtime connection with id "${input.connectionId}".`);
    }
  }
}
