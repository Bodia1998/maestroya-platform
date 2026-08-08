import "server-only";

import type { IncomingMessage, Server as HttpServer } from "node:http";
import type { Socket } from "node:net";
import { createHash, randomUUID } from "node:crypto";
import { getToken } from "next-auth/jwt";

import { env } from "@/infrastructure/config/env";
import { logger } from "@/infrastructure/observability/logger";
import type { RealtimeHub } from "@/application/services/realtime/realtime-hub";
import type { RealtimeOutboundEvent, RealtimeSink } from "@/application/ports/realtime-registry";
import { decodeFrame, encodeFrame, encodeText, OPCODE } from "@/infrastructure/realtime/websocket-frame-codec";

const WEBSOCKET_MAGIC_STRING = "258EAFA5-E914-47DA-95CA-C5AB0DC85B11";
const UPGRADE_PATH = "/realtime/ws";

/**
 * Module 48 — Real-Time System.
 *
 * The WebSocket transport. Next.js's App Router Route Handlers run inside
 * Next's own request pipeline and have no way to take over an HTTP
 * `upgrade` event (there is no `Upgrade`-capable Route Handler API) —
 * WebSockets in a Next.js app always require a custom Node HTTP server
 * sitting in front of (or beside) Next, which is exactly what this class
 * is: an attachable `upgrade` handler, not a Next.js route. It is
 * deliberately **not** wired into `next dev`/`next start` (see
 * `package.json`'s unchanged `dev`/`start` scripts) — attaching it is an
 * explicit, additive step (`scripts/realtime-gateway.ts`, `npm run
 * realtime:gateway`) so the default application boot sequence is
 * completely unchanged; this preserves the "architecture MUST remain
 * exactly as it is" / "no breaking changes" constraints while still
 * providing a real, working WebSocket implementation (not a stub). See
 * `docs/MODULE_48_REALTIME_SYSTEM.md`'s "WebSockets" and "Deployment
 * considerations" sections for the full reasoning and the two supported
 * deployment shapes (attached to the same server as Next via a custom
 * entry point, or run as an independent sidecar process).
 *
 * Hand-rolls the RFC 6455 handshake and frame protocol (see
 * `websocket-frame-codec.ts`) rather than depending on the `ws` package —
 * this codebase adds no new runtime dependencies for this module, mirroring
 * `infrastructure/cache/redis-client.ts`'s own hand-rolled RESP2 client.
 *
 * Authenticates every upgrade request via the existing Auth.js JWT session
 * cookie (`next-auth/jwt`'s `getToken`, the same verification Auth.js's
 * own middleware uses) *before* completing the WebSocket handshake — an
 * unauthenticated or expired session gets the handshake refused outright,
 * never a connected-then-immediately-closed socket.
 */
export class RealtimeWebSocketServer {
  private readonly sockets = new Map<string, Socket>();

  constructor(private readonly hub: RealtimeHub) {}

  /** Attaches this server's `upgrade` handling to an existing `http.Server` — additive, does not replace any existing `request`/`upgrade` listener. */
  attach(server: HttpServer): void {
    server.on("upgrade", (request, socket, head) => {
      this.handleUpgrade(request, socket as Socket, head).catch((error) => {
        logger.error("realtime_ws_upgrade_failed", { error });
        socket.destroy();
      });
    });
  }

  get activeSocketCount(): number {
    return this.sockets.size;
  }

  private async handleUpgrade(request: IncomingMessage, socket: Socket, head: Buffer): Promise<void> {
    const url = new URL(request.url ?? "/", `http://${request.headers.host ?? "localhost"}`);
    if (url.pathname !== UPGRADE_PATH) {
      socket.destroy();
      return;
    }

    const key = request.headers["sec-websocket-key"];
    if (typeof key !== "string" || request.headers.upgrade?.toLowerCase() !== "websocket") {
      socket.write("HTTP/1.1 400 Bad Request\r\n\r\n");
      socket.destroy();
      return;
    }

    const token = await getToken({ req: request as never, secret: env.AUTH_SECRET }).catch(() => null);
    const userId = typeof token?.id === "string" ? token.id : null;
    const roles = Array.isArray(token?.roles) ? (token.roles as string[]) : [];
    if (!userId) {
      socket.write("HTTP/1.1 401 Unauthorized\r\n\r\n");
      socket.destroy();
      return;
    }

    const acceptKey = createHash("sha1").update(key + WEBSOCKET_MAGIC_STRING).digest("base64");
    socket.write(
      "HTTP/1.1 101 Switching Protocols\r\n" +
        "Upgrade: websocket\r\n" +
        "Connection: Upgrade\r\n" +
        `Sec-WebSocket-Accept: ${acceptKey}\r\n\r\n`,
    );

    const connectionId = randomUUID();
    this.sockets.set(connectionId, socket);

    const sink: RealtimeSink = {
      send: (event: RealtimeOutboundEvent) => {
        if (socket.destroyed) return;
        socket.write(encodeText(JSON.stringify({ type: event.type, channel: event.channel, payload: event.payload, occurredAt: event.occurredAt })));
      },
      close: (reason?: string) => {
        if (!socket.destroyed) {
          socket.write(encodeFrame(OPCODE.CLOSE, Buffer.alloc(0)));
          socket.end();
        }
        logger.info("realtime_ws_socket_closed", { connectionId, reason });
      },
    };

    this.hub.connect({ userId, roles, transport: "WS", sink, connectionId });

    let buffer: Buffer = head.length > 0 ? Buffer.from(head) : Buffer.alloc(0);

    socket.on("data", (chunk: Buffer) => {
      buffer = Buffer.concat([buffer, chunk]);
      buffer = this.drainFrames(connectionId, socket, buffer);
    });

    const cleanup = () => {
      this.sockets.delete(connectionId);
      this.hub.disconnect(connectionId, "socket_closed");
    };
    socket.on("close", cleanup);
    socket.on("error", (error) => {
      logger.warn("realtime_ws_socket_error", { connectionId, error });
      cleanup();
    });
  }

  private drainFrames(connectionId: string, socket: Socket, buffer: Buffer): Buffer {
    let remaining = buffer;
    // Bounded loop: at most one frame is consumed per iteration, and every
    // branch either advances `remaining` or returns — this cannot spin.
    for (let guard = 0; guard < 1000; guard += 1) {
      const result = decodeFrame(remaining);
      if (result.status === "incomplete") return remaining;
      if (result.status === "oversized" || result.status === "invalid") {
        socket.write(encodeFrame(OPCODE.CLOSE, Buffer.alloc(0)));
        socket.end();
        return Buffer.alloc(0);
      }

      const { frame } = result;
      remaining = remaining.subarray(frame.frameLength);

      switch (frame.opcode) {
        case OPCODE.PING:
          socket.write(encodeFrame(OPCODE.PONG, frame.payload));
          break;
        case OPCODE.CLOSE:
          socket.end();
          return Buffer.alloc(0);
        case OPCODE.TEXT:
          this.handleTextMessage(connectionId, frame.payload.toString("utf8"));
          break;
        default:
          break;
      }
    }
    return remaining;
  }

  private handleTextMessage(connectionId: string, raw: string): void {
    let message: { action?: string; channel?: string };
    try {
      message = JSON.parse(raw);
    } catch {
      return;
    }

    if (message.action === "heartbeat") {
      this.hub.heartbeat(connectionId);
      return;
    }
    if (message.action === "subscribe" && typeof message.channel === "string") {
      this.hub.subscribe(connectionId, message.channel).catch((error) => {
        logger.warn("realtime_ws_subscribe_rejected", { connectionId, channel: message.channel, error });
      });
      return;
    }
    if (message.action === "unsubscribe" && typeof message.channel === "string") {
      this.hub.unsubscribe(connectionId, message.channel);
    }
  }
}
