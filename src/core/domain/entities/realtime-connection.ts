/**
 * Module 48 — Real-Time System.
 *
 * A `RealtimeConnection` is one authenticated client session attached to
 * the realtime layer — one browser tab's SSE stream, or one WebSocket
 * socket. A single user commonly has several of these at once (multiple
 * devices/tabs), which is exactly what `PresenceStore` (application/ports)
 * tracks per user rather than per connection.
 *
 * Deliberately transport-agnostic and free of any actual I/O — `transport`
 * only records *which kind* of connection this is for observability/health
 * reporting; the connection's `send`/`close` behavior lives on the
 * `RealtimeSink` the concrete transport (SSE route handler, WebSocket
 * server) hands to `ConnectionRegistry` when the connection is
 * registered (see `application/ports/realtime-registry.ts`). Keeping this
 * class a plain data holder (no closures, no sockets) is what makes it
 * safe to snapshot for health/presence reporting and trivial to unit test.
 */

export type RealtimeTransportKind = "SSE" | "WS";

export interface RealtimeConnectionProps {
  readonly id: string;
  readonly userId: string;
  readonly roles: readonly string[];
  readonly transport: RealtimeTransportKind;
  readonly connectedAt: Date;
  lastHeartbeatAt: Date;
  readonly channels: Set<string>;
}

export class RealtimeConnection {
  readonly id: string;
  readonly userId: string;
  readonly roles: readonly string[];
  readonly transport: RealtimeTransportKind;
  readonly connectedAt: Date;
  private _lastHeartbeatAt: Date;
  private readonly _channels: Set<string>;

  constructor(props: {
    id: string;
    userId: string;
    roles: readonly string[];
    transport: RealtimeTransportKind;
    connectedAt?: Date;
  }) {
    this.id = props.id;
    this.userId = props.userId;
    this.roles = props.roles;
    this.transport = props.transport;
    this.connectedAt = props.connectedAt ?? new Date();
    this._lastHeartbeatAt = this.connectedAt;
    this._channels = new Set();
  }

  get lastHeartbeatAt(): Date {
    return this._lastHeartbeatAt;
  }

  get channels(): ReadonlySet<string> {
    return this._channels;
  }

  subscribe(channel: string): void {
    this._channels.add(channel);
  }

  unsubscribe(channel: string): void {
    this._channels.delete(channel);
  }

  isSubscribedTo(channel: string): boolean {
    return this._channels.has(channel);
  }

  recordHeartbeat(at: Date = new Date()): void {
    this._lastHeartbeatAt = at;
  }

  /** `true` once this connection has gone silent for longer than `ttlMs` — the sweep condition `RealtimeHub`'s reaper uses to evict stale connections whose transport never signalled a clean close (a dropped WiFi connection, a killed mobile app, ...). */
  isExpired(ttlMs: number, now: Date = new Date()): boolean {
    return now.getTime() - this._lastHeartbeatAt.getTime() > ttlMs;
  }
}
