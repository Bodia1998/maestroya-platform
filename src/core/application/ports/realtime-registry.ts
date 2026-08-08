import type { RealtimeConnection } from "@/domain/entities/realtime-connection";

/**
 * Module 48 — Real-Time System.
 *
 * The one thing a transport (SSE route handler, WebSocket server) gives
 * the application layer when a client connects: a way to push an event to
 * that specific client, and a way to end the connection. Everything the
 * application layer needs to know about "how do bytes actually reach this
 * browser" is captured in these two functions — `RealtimeHub` and every
 * use case above it work only against `RealtimeConnection` + `RealtimeSink`,
 * never against `ReadableStreamDefaultController`/`net.Socket`/etc.
 * directly. This is the seam that makes the SSE and WebSocket transports
 * (and any future one — Pusher, Ably, a Redis-backed fan-out relay)
 * interchangeable without touching a single use case.
 */
export interface RealtimeSink {
  /** Delivers one event to this connection. Must never throw — a dead/slow
   *  connection is reported via the registry's own delivery-failure
   *  accounting (see `ConnectionRegistry.recordDeliveryFailure`), not by
   *  throwing back into the publisher's call stack. */
  send(event: RealtimeOutboundEvent): void;
  /** Ends the connection from the server side (idle timeout, forced
   *  logout, graceful shutdown). Idempotent. */
  close(reason?: string): void;
}

/** The event shape delivered to a connection — the wire-level payload both
 *  the SSE and WebSocket transports serialize identically, so a client
 *  never has to know which transport it's connected over. */
export interface RealtimeOutboundEvent {
  readonly id: string;
  readonly type: string;
  readonly channel: string;
  readonly payload: unknown;
  readonly occurredAt: string;
}

/**
 * Tracks every live connection and its channel subscriptions for this
 * process. The default (`InMemoryConnectionRegistry`) is per-instance —
 * correct for a single-instance deployment or for any one instance's own
 * clients — see `docs/MODULE_48_REALTIME_SYSTEM.md`'s "Scaling strategy"
 * section for how this generalizes to multiple instances behind a load
 * balancer via a Redis pub/sub relay sitting *in front of* this port
 * (`RealtimeBroadcaster`, not this registry, is the piece that becomes
 * distributed — the registry itself only ever needs to know about the
 * connections physically attached to this process).
 */
export interface ConnectionRegistry {
  register(connection: RealtimeConnection, sink: RealtimeSink): void;
  unregister(connectionId: string): void;
  get(connectionId: string): RealtimeConnection | null;
  subscribe(connectionId: string, channel: string): void;
  unsubscribe(connectionId: string, channel: string): void;
  /** Every connection currently subscribed to `channel`, for delivery. */
  listByChannel(channel: string): RealtimeConnection[];
  /** Every connection belonging to `userId` — multi-device presence. */
  listByUser(userId: string): RealtimeConnection[];
  list(): RealtimeConnection[];
  count(): number;
  /** Delivers `event` to one already-registered connection via the sink it
   *  was registered with. Returns `false` (never throws) if the
   *  connection is unknown or delivery failed. */
  deliver(connectionId: string, event: RealtimeOutboundEvent): boolean;
}
