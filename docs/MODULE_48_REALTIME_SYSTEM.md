# Module 48 — Real-Time System

## 1. Goal

Give the platform an enterprise-grade real-time communication layer — authenticated, authorized, observable, and transport-agnostic — that every other module can push live updates through, without duplicating any of the platform's existing infrastructure (EventBus, notifications, auth, caching, observability, health).

This module does not introduce a new source of truth. PostgreSQL remains authoritative for every fact; the realtime layer only ever *republishes* facts that already happened (a domain event, a notification being created) to whichever clients are currently connected and authorized to see them. A client that was offline when something happened simply reads the current state the normal way (REST/Server Component) the next time it loads — realtime is a live-update convenience layer, never a delivery guarantee.

## 2. Architecture

### 2.1 Layering

```
domain/value-objects/
  realtime-channel.ts            (RealtimeChannel — parses/validates "type:id" channel names)

domain/entities/
  realtime-connection.ts         (RealtimeConnection — one live client session; transport-agnostic)

application/ports/
  realtime-registry.ts           (ConnectionRegistry, RealtimeSink — the transport seam)
  presence-store.ts              (PresenceStore)
  realtime-access-checker.ts     (RealtimeAccessChecker — resource-ownership lookups)

application/services/realtime/
  realtime-hub.ts                 (RealtimeHub — connect/subscribe/publish/heartbeat/disconnect orchestration)
  channel-authorization.service.ts (ChannelAuthorizationService — who may subscribe to what)
  realtime-metrics.ts             (RealtimeMetrics — in-process counters for health/observability)

application/use-cases/realtime/
  subscribe-to-channel.use-case.ts
  unsubscribe-from-channel.use-case.ts
  publish-to-channel.use-case.ts
  record-heartbeat.use-case.ts
  get-presence.use-case.ts
  get-realtime-health.use-case.ts
  broadcast-domain-event.subscriber.ts  (generic DomainEvent -> channel bridge)
  compose.ts                      (registers the domain-event subscribers; exposes make*UseCase())

infrastructure/realtime/
  in-memory-connection-registry.ts  (default ConnectionRegistry)
  in-memory-presence-store.ts       (default PresenceStore)
  prisma-realtime-access-checker.ts (RealtimeAccessChecker, reusing existing repositories)
  sse-transport.ts                  (SseSink — Server-Sent Events wire adapter)
  websocket-frame-codec.ts          (hand-rolled RFC 6455 frame encode/decode)
  websocket-server.ts               (RealtimeWebSocketServer — attaches to an http.Server)
  compose.ts                        (composition root: realtimeHub singleton, getRealtimeHealth())

infrastructure/notifications/channels/
  realtime-notification-channel.ts  (RealTimeNotificationChannel — now a real NotificationChannelAdapter)

app/api/realtime/
  sse/route.ts                    (GET — the primary transport)
  channels/route.ts               (POST/DELETE — dynamic subscribe/unsubscribe)
  presence/[userId]/route.ts      (GET — presence read)

scripts/realtime-gateway.ts       (standalone WebSocket gateway entry point — see §6)
```

### 2.2 Why this shape

Every port here (`ConnectionRegistry`, `PresenceStore`, `RealtimeAccessChecker`) exists because `RealtimeHub` — the one orchestration class every transport and every use case goes through — must never know *how* a connection was made (SSE vs WebSocket vs a future provider) or *how* authorization/ownership is actually checked (Prisma today, something else tomorrow). This is the same "port in application, one real implementation in infrastructure" discipline every other module in this codebase follows (`SearchIndexProvider`, `CacheProvider`, `GeocodingProvider`, ...).

`RealtimeHub` is one class, not five separate use-case classes each reimplementing connect/subscribe/publish orchestration — see that class's own doc comment for why. The CQRS use cases in `application/use-cases/realtime/` are the thin, individually-mockable command/query objects route handlers and subscribers actually depend on; each delegates to exactly one `RealtimeHub` method.

## 3. Channels

A channel is `type` or `type:resourceId`, validated by `RealtimeChannel.parse()`:

| Channel | Shape | Who may subscribe |
|---|---|---|
| `admin` | singleton | Staff only (ADMIN/SUPER_ADMIN/SUPPORT/MODERATOR) |
| `user:{id}` | resource | The user themselves, or staff |
| `professional:{id}` | resource | The owning professional, or staff |
| `company:{id}` | resource | An active member of that company, or staff |
| `booking:{id}` | resource | A participant of the underlying `Job` (customer, assigned professional, or an active member of the assigned company) — see §3.1 |
| `quote:{id}` | resource | Same participant rule as `booking:{id}` |
| `service-request:{id}` | resource | Same participant rule as `booking:{id}` |
| `dispute:{id}` | resource | The dispute's raiser, or a participant of its underlying Job, or staff |
| `chat:{id}` | resource | An active member of that Conversation, or staff |
| `search-index:{id}` | resource | Staff only (operational visibility) |
| `job-queue:{id}` | resource | Staff only (operational visibility) |

Authorization for every channel goes through exactly one place: `ChannelAuthorizationService.canSubscribe()`, called from `RealtimeHub.subscribe()`. There is no second code path that grants a subscription — the SSE route, the WebSocket gateway, and `POST /api/realtime/channels` all call the same `SubscribeToChannelUseCase`.

### 3.1 "Booking" maps onto `Job`

This domain model has no separate `Booking` entity — the closest concept is `Job` (see `prisma/schema.prisma`). `booking:{id}`, `quote:{id}`, and `service-request:{id}` are all authorized against the same Job-level participant set `resolveDisputeParticipantUserIds` (`application/use-cases/dispute/`) already computes for dispute notification fan-out; `PrismaRealtimeAccessChecker.isJobParticipant` mirrors that function exactly, reusing the same repositories (`JobRepository`, `CustomerProfileRepository`, `ProfessionalRepository`, `CompanyMembershipRepository`) rather than re-deriving the rule.

## 4. Connection lifecycle

1. **Connect** — a client opens `GET /api/realtime/sse` (or, if the optional WebSocket gateway is running, a `wss://` connection to `/realtime/ws`). Both transports authenticate the request via the existing Auth.js session (`getCurrentUser()` for SSE — a normal Route Handler; `next-auth/jwt`'s `getToken()` for the WebSocket gateway, which runs outside Next's own request pipeline). An unauthenticated request never reaches `RealtimeHub.connect()`.
2. **Subscribe** — the client lists channels at connect time (`?channels=dispute:d1,chat:c1` for SSE; a `subscribe` control frame for WebSocket) and/or later via `POST /api/realtime/channels`. Each channel is independently authorized; a rejected channel never tears down the whole connection.
3. **Heartbeat** — SSE writes a `: heartbeat` comment every `REALTIME_HEARTBEAT_INTERVAL_MS`; a WebSocket client sends a `{"action":"heartbeat"}` control frame on the same cadence. `RealtimeHub.reapExpired()` evicts any connection silent for longer than `REALTIME_CONNECTION_TTL_MS`.
4. **Reconnect** — `EventSource`'s native retry handles SSE reconnection with no custom protocol. A dropped WebSocket is reconnected client-side the same way any WebSocket client reconnects; on reconnect, the client re-authenticates and re-subscribes exactly as it did on first connect (no server-side session resumption is implemented — every reconnect is a fresh, fully re-authorized connection, which is the safer default).
5. **Disconnect** — a clean client close, an idle-timeout eviction, or a server graceful shutdown all funnel through `RealtimeHub.disconnect()`, which unregisters the connection and updates presence.

## 5. Authentication

Both transports authenticate *before* any data is exchanged — an unauthenticated SSE request gets `401` before the stream ever opens; an unauthenticated WebSocket upgrade is refused at the handshake (`401` written to the raw socket, then closed) rather than accepted and immediately dropped. Both reuse the existing Auth.js v5 JWT session — no new credential type, no new secret. See `rbac.ts`'s `getCurrentUser()` (SSE, and every other Route Handler in this codebase) and `next-auth/jwt`'s `getToken()` (the WebSocket gateway, which needs to verify the session cookie outside of a Next.js request context).

## 6. WebSockets

Next.js's App Router has no way for a Route Handler to take over an HTTP `upgrade` event — WebSockets in any Next.js app require a Node HTTP server that isn't purely `next`'s own CLI. This codebase's `dev`/`build`/`start` scripts are explicitly out of scope to change ("the architecture MUST remain exactly as it is"), so the WebSocket transport ships as an **additive, optional, independently started sidecar**: `RealtimeWebSocketServer.attach(server)` attaches to any `http.Server`, and `scripts/realtime-gateway.ts` (`npm run realtime:gateway`) is a small standalone process that does exactly that. It shares the exact same `RealtimeHub` singleton (`infrastructure/realtime/compose.ts`) the in-process SSE transport uses, so a message published while both transports are running reaches both kinds of client identically.

No `ws`/`socket.io` package is added — this codebase's own convention (see `infrastructure/cache/redis-client.ts`'s hand-rolled RESP2 client) is to hand-roll a protocol rather than add a dependency when the protocol is small enough to implement directly and testably. `websocket-frame-codec.ts` implements the RFC 6455 handshake response and frame format directly (single-frame text/close/ping/pong, up to 64KB — everything this transport's JSON control/event messages need); it is pure functions, unit-tested without a socket.

Two supported deployment shapes:
- **Sidecar process** — run `realtime-gateway.ts` as its own service (its own container/process), reverse-proxied at e.g. `wss://app.example.com/realtime/ws`. Simplest; scales independently of the Next.js instances.
- **Embedded** — a deployment that already runs a custom Node entry point (rather than `next start` directly) can call `wsServer.attach(server)` on that same `http.Server`. `RealtimeWebSocketServer` only ever attaches; it never assumes it owns the process.

A deployment that runs neither is still fully functional — the SSE transport alone covers every "live updates" requirement this module has; `getRealtimeHealth()`'s `transports.websocket` simply reports `"not_configured"`.

## 7. Event flow

Two independent paths feed the realtime layer, and neither duplicates the other:

1. **Personal notifications** (bookings, chat, disputes, quotes, service requests, reviews, verification, GDPR, ...) already flow through the existing `NotificationCreator` → `NotificationDispatcher` chokepoint (`~20` call sites across the codebase, unchanged). Module 48's only change here is `NotificationServiceCreator`'s `channels` default: `["IN_APP"]` → `["IN_APP", "REALTIME"]`. `RealTimeNotificationChannel` (a real `NotificationChannelAdapter` now, no longer a stub) publishes the notification onto the recipient's `user:{id}` channel. This one, tiny, additive change is what makes every existing notification-producing flow in the platform realtime — with zero call-site changes anywhere else.
2. **Resource/thread channels** (`dispute:{id}`, `service-request:{id}`) are fed by `application/use-cases/realtime/compose.ts`, which registers a `BroadcastDomainEventSubscriber` per `DomainEvent` class that has an obvious "thread" a client would be subscribed to (today: `DisputeCreated`, `DisputeStatusChanged`, `DisputeAssigned`, `DisputeMessageAdded`, `ServiceRequestUpdated`). Registration goes through the *existing* shared `eventBus.subscribe(...)` — this module adds handlers, never a second EventBus or a competing dispatch mechanism.

Background job lifecycle and search-indexing progress are, in this codebase, the same underlying job-queue system (`infrastructure/jobs/`); their live status is exposed today via the existing `checks.queue`/`checks.searchEngine` readiness sections plus this module's `job-queue:{id}`/`search-index:{id}` channel types, which staff tooling can publish onto via `PublishToChannelUseCase` directly as that tooling is built out — the channel, authorization rule, and delivery path already exist end-to-end; only a producer needs to call it.

## 8. Presence

`PresenceStore` tracks, per user, the set of currently-open connection ids (multiple devices/tabs supported natively — a user is `ONLINE` iff that set is non-empty) and the timestamp of their most recent disconnect (`lastSeenAt`, retained after going offline). `GetPresenceUseCase` restricts reads to the user themselves or staff — presence is personal information.

## 9. Health

`GET /api/health/ready`'s `checks.realtime` (via `getRealtimeHealth()`) reports:

```json
{
  "status": "ok",
  "transports": { "sse": "ok", "websocket": "not_configured" },
  "activeConnections": 0,
  "activeChannels": 0,
  "onlineUsers": 0,
  "metrics": {
    "connectionsOpenedTotal": 0, "connectionsClosedTotal": 0, "activeConnections": 0,
    "broadcastsTotal": 0, "messagesDeliveredTotal": 0, "deliveryFailuresTotal": 0,
    "connectionsByTransport": {}
  }
}
```

Visibility-only, exactly like `checks.cachingLayer`/`checks.searchEngine` — a degraded realtime layer never flips `/api/health/ready`'s overall status or HTTP code, since every realtime client already has its own reconnect logic and no write path in the platform depends on realtime delivery succeeding.

## 10. Observability

Structured logging goes through the existing `logger` (`infrastructure/observability/logger.ts`) — `realtime_connection_opened`, `realtime_connection_closed`, `realtime_delivery_failed`, `realtime_sse_initial_subscribe_rejected`, `realtime_ws_*`, etc. Unexpected exceptions in the SSE/channel/presence Route Handlers are reported via the existing `createErrorReporter()` (Sentry in production, console otherwise), the identical pattern every other Route Handler in this codebase follows.

There is no metrics backend (Prometheus/StatsD) anywhere in this codebase, so `RealtimeMetrics` is an in-process counter accumulator — connections opened/closed (by transport), broadcasts, messages delivered, delivery failures — exposed through `getRealtimeHealth()`, mirroring how `infrastructure/jobs/queue-health.ts` and `infrastructure/search/search-health.ts` report their own in-memory counters.

## 11. Scaling strategy / Redis pub/sub readiness

Today's `ConnectionRegistry`/`PresenceStore` are in-memory and per-instance — correct for a single Next.js instance (and, for the WebSocket transport, its one gateway process). Behind a load balancer with more than one instance, a client's SSE/WebSocket connection is pinned to exactly one instance (normal for both transports — a sticky/consistent connection, not a stateless HTTP request), but a `publish()` call on instance A must also reach clients connected to instance B.

The fix is additive, not a rewrite, because every use case and `RealtimeHub` itself are already written only against the `ConnectionRegistry`/`PresenceStore` *ports*:

1. Add a `RealtimeBroadcastRelay` port: `publish(channel, event)` / `onMessage(handler)`.
2. Implement it over Redis pub/sub. This codebase's `RedisClient` (`infrastructure/cache/redis-client.ts`) is a minimal hand-rolled RESP2 client that explicitly does not implement `SUBSCRIBE` today (that command changes the connection into push-only framing, which needs a second, dedicated connection) — the relay's Redis implementation would extend `RedisClient` with `PUBLISH`/`SUBSCRIBE` support, or use a second lightweight connection dedicated to the subscribe side, the same "one extra connection, same hand-rolled protocol" shape `infrastructure/jobs`'s BullMQ-style queue already accepts for its own Redis usage.
3. `RealtimeHub.publish()` calls the local registry (unchanged) *and* the relay; the relay's `onMessage` handler calls the local registry on every other instance. Each instance still only ever delivers to connections physically attached to itself — no cross-instance connection routing is needed.
4. `PresenceStore` gets a Redis-backed implementation (a set per user, `SADD`/`SREM`/`SCARD`, all commands the existing hand-rolled `RedisClient.command()` already supports today with no changes) so presence is process-wide-correct rather than per-instance.

None of this changes `RealtimeChannel`, `ChannelAuthorizationService`, the CQRS use cases, the SSE/WebSocket wire formats, or any Route Handler — the exact same "swap the Redis-backed implementation in behind an existing port" pattern Modules 44/45/46 already established for cache/jobs/queues in this codebase.

## 12. Deployment considerations

- **SSE works everywhere Next.js already runs** — no additional process, no additional port, no infrastructure change. This is the transport every deployment gets "for free".
- **The WebSocket gateway is optional.** Enable it by running `npm run realtime:gateway` alongside the main app and setting `REALTIME_WS_ENABLED=true` (visibility only — it does not start anything by itself); route `wss://.../realtime/ws` to its `REALTIME_WS_PORT` at the reverse proxy/load balancer.
- **Graceful shutdown**: the gateway process handles `SIGTERM`/`SIGINT` — stops accepting new heartbeats, closes its HTTP server, and exits, mirroring `instrumentation.ts`'s existing shutdown hook for background jobs.
- **Multi-instance**: see §11. A single-instance deployment (the common case for this platform today) needs no further changes at all.
- **Idle timeouts**: any reverse proxy/load balancer in front of the SSE endpoint must allow long-lived connections (disable read timeout or set it comfortably above `REALTIME_HEARTBEAT_INTERVAL_MS`) — the heartbeat exists specifically to keep such a proxy's idle timeout from firing.

## 13. Configuration

| Variable | Default | Purpose |
|---|---|---|
| `REALTIME_HEARTBEAT_INTERVAL_MS` | `25000` | SSE heartbeat cadence / expected WebSocket client heartbeat cadence |
| `REALTIME_CONNECTION_TTL_MS` | `90000` | Silence duration before a connection is reaped |
| `REALTIME_WS_ENABLED` | `false` | Health-report-only flag: is the WebSocket gateway expected to be running |
| `REALTIME_WS_PORT` | `3001` | Port the standalone WebSocket gateway listens on |
| `REALTIME_MAX_CONNECTIONS_PER_USER` | `10` | Reserved cap for future enforcement against a runaway client |

Every value uses `.catch()` in `env.ts`, matching this codebase's convention for operational tuning knobs: a typo or invalid value falls back to the safe default rather than failing application startup.

## 14. Testing

- `tests/unit/core/domain/**` — `RealtimeChannel` parsing/validation, `RealtimeConnection` lifecycle.
- `tests/unit/core/application/**` — `ChannelAuthorizationService` policy, `RealtimeHub` orchestration, `BroadcastDomainEventSubscriber`.
- `tests/unit/core/infrastructure/realtime/**` — in-memory registry/presence store, the WebSocket frame codec (masked/unmasked, fragmented, multi-frame buffers), the SSE sink.
- `tests/unit/core/infrastructure/notifications/**` — `RealTimeNotificationChannel`.
- `tests/integration/realtime/**` — end-to-end connect → subscribe → publish → disconnect flows (including an authorization rejection and a heartbeat-timeout eviction) against the real composed stack, plus `getRealtimeHealth()` against the actual process-wide singleton.

## 15. What this module deliberately does not do

- No new database table — connections and presence are process-memory only, by design; a restart is a normal, expected "everyone reconnects" event, exactly like any other realtime system.
- No delivery guarantee/replay — a client offline when an event fires does not receive it later over the realtime channel; it reads current state the normal way on its next load.
- No new runtime dependency (`ws`/`socket.io`/Pusher/Ably/etc.) — the WebSocket transport is hand-rolled, matching this codebase's existing convention for small protocols (RESP2 in `redis-client.ts`).
- No change to `next dev`/`next build`/`next start` — the WebSocket gateway is a fully separate, optional entry point.
