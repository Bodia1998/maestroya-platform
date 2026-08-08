import type { NextRequest } from "next/server";

import { getCurrentUser } from "@/infrastructure/auth/rbac";
import { logger } from "@/infrastructure/observability/logger";
import { REQUEST_ID_HEADER, resolveRequestId } from "@/infrastructure/observability/request-id";
import { env } from "@/infrastructure/config/env";
import { realtimeHub } from "@/infrastructure/realtime/compose";
import { SseSink } from "@/infrastructure/realtime/sse-transport";
// Side-effect import: registers the realtime domain-event subscribers so
// this route (the primary, always-on realtime transport) works correctly
// even in a deployment that never starts the optional WebSocket gateway —
// see `application/use-cases/realtime/compose.ts`'s own doc comment.
// instrumentation.ts already imports this at boot in a real server
// process; this import is the same "safe to import more than once, module
// caching makes it idempotent" pattern every other route in this codebase
// that depends on subscriber registration relies on implicitly via
// instrumentation.ts. Imported explicitly here too since Route Handlers
// can be invoked in edge/serverless contexts where instrumentation.ts's
// own timing is less certain.
import "@/application/use-cases/realtime/compose";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * Module 48 — Real-Time System.
 *
 * The Server-Sent Events endpoint — the primary, always-on realtime
 * transport (works in every deployment, no custom server required, unlike
 * the optional WebSocket gateway — see `websocket-server.ts`'s doc
 * comment). A browser opens this with `new EventSource("/api/realtime/sse?channels=...")`;
 * the connection is authenticated via the existing Auth.js session
 * (`getCurrentUser`) exactly like any other route handler in this
 * codebase, reconnects are handled entirely client-side by `EventSource`'s
 * own native retry behavior (no custom reconnect protocol needed), and a
 * `: heartbeat` comment is written every
 * `REALTIME_HEARTBEAT_INTERVAL_MS` to keep the connection (and any
 * intermediary proxy's idle timeout) alive.
 *
 * `channels` is a comma-separated list of channel names to subscribe to
 * immediately on connect — each one independently authorized via
 * `RealtimeHub.subscribe`/`ChannelAuthorizationService`; an unauthorized
 * or malformed channel in the list is skipped (reported in the initial
 * `connected` event's `rejectedChannels`), never a reason to refuse the
 * whole connection. More channels can be added later over
 * `POST /api/realtime/channels`.
 */
export async function GET(request: NextRequest) {
  const requestId = resolveRequestId(request.headers.get(REQUEST_ID_HEADER));

  const user = await getCurrentUser();
  if (!user) {
    return new Response(JSON.stringify({ status: "error", message: "Unauthorized." }), {
      status: 401,
      headers: { "content-type": "application/json", [REQUEST_ID_HEADER]: requestId },
    });
  }

  const requestedChannels = (request.nextUrl.searchParams.get("channels") ?? "")
    .split(",")
    .map((c) => c.trim())
    .filter(Boolean);

  let heartbeatTimer: ReturnType<typeof setInterval> | undefined;
  let connectionId: string | undefined;

  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      const sink = new SseSink(controller, (reason) => {
        if (connectionId) realtimeHub.disconnect(connectionId, reason);
        if (heartbeatTimer) clearInterval(heartbeatTimer);
      });

      const connection = realtimeHub.connect({ userId: user.id, roles: user.roles, transport: "SSE", sink });
      connectionId = connection.id;

      const rejectedChannels: string[] = [];
      void (async () => {
        for (const channel of requestedChannels) {
          try {
            await realtimeHub.subscribe(connection.id, channel);
          } catch (error) {
            rejectedChannels.push(channel);
            logger.warn("realtime_sse_initial_subscribe_rejected", { requestId, connectionId: connection.id, channel, error });
          }
        }
        sink.send({
          id: connection.id,
          type: "connected",
          channel: "system",
          payload: { connectionId: connection.id, subscribedChannels: [...connection.channels], rejectedChannels },
          occurredAt: new Date().toISOString(),
        });
      })();

      heartbeatTimer = setInterval(() => sink.sendHeartbeat(), env.REALTIME_HEARTBEAT_INTERVAL_MS);
    },
    cancel(reason) {
      if (connectionId) realtimeHub.disconnect(connectionId, typeof reason === "string" ? reason : "client_disconnected");
      if (heartbeatTimer) clearInterval(heartbeatTimer);
    },
  });

  return new Response(stream, {
    status: 200,
    headers: {
      "content-type": "text/event-stream",
      "cache-control": "no-cache, no-transform",
      connection: "keep-alive",
      [REQUEST_ID_HEADER]: requestId,
    },
  });
}
