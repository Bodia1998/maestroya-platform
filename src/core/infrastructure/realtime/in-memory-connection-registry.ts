import type { RealtimeConnection } from "@/domain/entities/realtime-connection";
import type { ConnectionRegistry, RealtimeOutboundEvent, RealtimeSink } from "@/application/ports/realtime-registry";
import { logger } from "@/infrastructure/observability/logger";

/**
 * Module 48 — Real-Time System.
 *
 * Per-process, in-memory `ConnectionRegistry` — the default and, for a
 * single-instance deployment, the only implementation needed. Mirrors
 * `InMemoryCacheProvider`/`InMemoryJobStore`'s own role in Modules 45/46:
 * a real, fully functional implementation of the port, not a stub, that
 * every other piece of this module is built and tested against.
 *
 * Indexes connections by id, by channel, and by user so every
 * `ConnectionRegistry` method is O(1)/O(subscriber count) rather than a
 * full scan — important here specifically because `deliver`/`listByChannel`
 * are on the hot path of every publish.
 */
export class InMemoryConnectionRegistry implements ConnectionRegistry {
  private readonly connections = new Map<string, RealtimeConnection>();
  private readonly sinks = new Map<string, RealtimeSink>();
  private readonly byChannel = new Map<string, Set<string>>();
  private readonly byUser = new Map<string, Set<string>>();

  register(connection: RealtimeConnection, sink: RealtimeSink): void {
    this.connections.set(connection.id, connection);
    this.sinks.set(connection.id, sink);
    this.indexByUser(connection.userId, connection.id, true);
  }

  unregister(connectionId: string): void {
    const connection = this.connections.get(connectionId);
    if (!connection) return;

    for (const channel of connection.channels) {
      this.byChannel.get(channel)?.delete(connectionId);
    }
    this.indexByUser(connection.userId, connectionId, false);
    this.connections.delete(connectionId);
    this.sinks.delete(connectionId);
  }

  get(connectionId: string): RealtimeConnection | null {
    return this.connections.get(connectionId) ?? null;
  }

  subscribe(connectionId: string, channel: string): void {
    if (!this.connections.has(connectionId)) return;
    if (!this.byChannel.has(channel)) this.byChannel.set(channel, new Set());
    this.byChannel.get(channel)!.add(connectionId);
  }

  unsubscribe(connectionId: string, channel: string): void {
    this.byChannel.get(channel)?.delete(connectionId);
  }

  listByChannel(channel: string): RealtimeConnection[] {
    const ids = this.byChannel.get(channel);
    if (!ids) return [];
    return [...ids].map((id) => this.connections.get(id)).filter((c): c is RealtimeConnection => c !== undefined);
  }

  listByUser(userId: string): RealtimeConnection[] {
    const ids = this.byUser.get(userId);
    if (!ids) return [];
    return [...ids].map((id) => this.connections.get(id)).filter((c): c is RealtimeConnection => c !== undefined);
  }

  list(): RealtimeConnection[] {
    return [...this.connections.values()];
  }

  count(): number {
    return this.connections.size;
  }

  deliver(connectionId: string, event: RealtimeOutboundEvent): boolean {
    const sink = this.sinks.get(connectionId);
    if (!sink) return false;
    try {
      sink.send(event);
      return true;
    } catch (error) {
      logger.warn("realtime_sink_send_failed", { connectionId, channel: event.channel, error });
      return false;
    }
  }

  private indexByUser(userId: string, connectionId: string, add: boolean): void {
    if (add) {
      if (!this.byUser.has(userId)) this.byUser.set(userId, new Set());
      this.byUser.get(userId)!.add(connectionId);
    } else {
      const set = this.byUser.get(userId);
      set?.delete(connectionId);
      if (set && set.size === 0) this.byUser.delete(userId);
    }
  }
}
