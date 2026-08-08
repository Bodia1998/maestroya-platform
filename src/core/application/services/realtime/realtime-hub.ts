import { randomUUID } from "node:crypto";

import { UnauthorizedError, ValidationError } from "@/domain/errors/domain-error";
import { RealtimeConnection, type RealtimeTransportKind } from "@/domain/entities/realtime-connection";
import { InvalidRealtimeChannelError, RealtimeChannel } from "@/domain/value-objects/realtime-channel";
import type { ConnectionRegistry, RealtimeSink } from "@/application/ports/realtime-registry";
import type { PresenceStore } from "@/application/ports/presence-store";
import type { ChannelAuthorizationService, RealtimePrincipal } from "@/application/services/realtime/channel-authorization.service";
import type { RealtimeMetrics } from "@/application/services/realtime/realtime-metrics";
import { logger } from "@/infrastructure/observability/logger";

/**
 * Module 48 — Real-Time System.
 *
 * The single orchestration point every realtime transport (SSE route
 * handler, WebSocket gateway) and every realtime use case goes through.
 * Owns nothing about *how* bytes reach a client (that's `RealtimeSink`,
 * supplied by the transport) — only the transport-agnostic rules:
 * who is connected, what are they subscribed to, are they allowed to be,
 * and who should receive a given published event.
 *
 * This is intentionally one class rather than one use case per operation
 * plus a shared service, because every operation here (connect, subscribe,
 * publish, heartbeat, disconnect) needs the exact same three collaborators
 * (`ConnectionRegistry`, `PresenceStore`, `ChannelAuthorizationService`)
 * and there is no independent business rule that benefits from being
 * split into its own use-case class. The CQRS use cases in
 * `application/use-cases/realtime/` are the thin, individually-testable,
 * individually-mockable command/query objects that route handlers and
 * subscribers actually depend on — each delegates to exactly one method
 * here, so the CQRS shape is preserved at the boundary the requirement
 * cares about (one intent in, one result out) without duplicating this
 * orchestration logic five times.
 */
export class RealtimeHub {
  constructor(
    private readonly registry: ConnectionRegistry,
    private readonly presence: PresenceStore,
    private readonly authorization: ChannelAuthorizationService,
    private readonly metrics: RealtimeMetrics,
  ) {}

  connect(params: {
    userId: string;
    roles: readonly string[];
    transport: RealtimeTransportKind;
    sink: RealtimeSink;
    connectionId?: string;
  }): RealtimeConnection {
    const connection = new RealtimeConnection({
      id: params.connectionId ?? randomUUID(),
      userId: params.userId,
      roles: params.roles,
      transport: params.transport,
    });
    this.registry.register(connection, params.sink);
    this.presence.markOnline(params.userId, connection.id);
    this.metrics.recordConnectionOpened(params.transport);
    logger.info("realtime_connection_opened", {
      connectionId: connection.id,
      userId: params.userId,
      transport: params.transport,
    });
    return connection;
  }

  disconnect(connectionId: string, reason?: string): void {
    const connection = this.registry.get(connectionId);
    if (!connection) return;
    this.registry.unregister(connectionId);
    this.presence.markOffline(connection.userId, connectionId);
    this.metrics.recordConnectionClosed(connection.transport);
    logger.info("realtime_connection_closed", { connectionId, userId: connection.userId, reason: reason ?? "unspecified" });
  }

  async subscribe(connectionId: string, rawChannel: string): Promise<RealtimeChannel> {
    const connection = this.registry.get(connectionId);
    if (!connection) throw new ValidationError(`No active realtime connection with id "${connectionId}".`);

    const channel = this.parseChannelOrThrow(rawChannel);
    const principal: RealtimePrincipal = { userId: connection.userId, roles: connection.roles };
    const allowed = await this.authorization.canSubscribe(principal, channel);
    if (!allowed) {
      throw new UnauthorizedError(`You are not authorized to subscribe to channel "${channel.toString()}".`);
    }

    this.registry.subscribe(connectionId, channel.toString());
    connection.subscribe(channel.toString());
    return channel;
  }

  unsubscribe(connectionId: string, rawChannel: string): void {
    const channel = this.parseChannelOrThrow(rawChannel);
    this.registry.unsubscribe(connectionId, channel.toString());
    this.registry.get(connectionId)?.unsubscribe(channel.toString());
  }

  /** Publishes `payload` to every connection currently subscribed to `channel`. Best-effort per recipient: one failed delivery never blocks the rest. Returns the count of connections it attempted delivery to. */
  publish(rawChannel: string, type: string, payload: unknown): number {
    const channel = this.parseChannelOrThrow(rawChannel);
    const subscribers = this.registry.listByChannel(channel.toString());

    const event = {
      id: randomUUID(),
      type,
      channel: channel.toString(),
      payload,
      occurredAt: new Date().toISOString(),
    };

    let delivered = 0;
    for (const connection of subscribers) {
      const ok = this.registry.deliver(connection.id, event);
      if (ok) {
        delivered += 1;
      } else {
        this.metrics.recordDeliveryFailure(channel.toString());
        logger.warn("realtime_delivery_failed", { connectionId: connection.id, channel: channel.toString(), type });
      }
    }
    this.metrics.recordBroadcast(channel.toString(), subscribers.length);
    return delivered;
  }

  heartbeat(connectionId: string, at: Date = new Date()): boolean {
    const connection = this.registry.get(connectionId);
    if (!connection) return false;
    connection.recordHeartbeat(at);
    return true;
  }

  /** Evicts every connection whose last heartbeat is older than `ttlMs` — the sweep a periodic reaper (or a lazy check on next publish) calls to bound resource usage from clients that disappeared without a clean close. */
  reapExpired(ttlMs: number, now: Date = new Date()): number {
    let evicted = 0;
    for (const connection of this.registry.list()) {
      if (connection.isExpired(ttlMs, now)) {
        this.disconnect(connection.id, "heartbeat_timeout");
        evicted += 1;
      }
    }
    return evicted;
  }

  presenceOf(userId: string) {
    return this.presence.getSnapshot(userId);
  }

  private parseChannelOrThrow(raw: string): RealtimeChannel {
    try {
      return RealtimeChannel.parse(raw);
    } catch (error) {
      if (error instanceof InvalidRealtimeChannelError) {
        throw new ValidationError(error.message);
      }
      throw error;
    }
  }
}
