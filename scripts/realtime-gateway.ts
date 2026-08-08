import { createServer } from "node:http";

import { env } from "@/infrastructure/config/env";
import { logger } from "@/infrastructure/observability/logger";
import { realtimeHub, reapExpiredRealtimeConnections } from "@/infrastructure/realtime/compose";
import { RealtimeWebSocketServer } from "@/infrastructure/realtime/websocket-server";
// Side-effect import: registers the realtime domain-event subscribers
// (dispute/service-request broadcasts) against the shared eventBus — the
// gateway process needs these too if it runs independently of the main
// Next.js server (see this file's own doc comment for the two supported
// deployment shapes).
import "@/application/use-cases/realtime/compose";

/**
 * Module 48 — Real-Time System.
 *
 * Standalone entry point for the WebSocket transport
 * (`RealtimeWebSocketServer`) — run via `npm run realtime:gateway`
 * (`tsx --conditions=react-server scripts/realtime-gateway.ts`).
 *
 * **Why a separate script, not part of `next dev`/`next start`:** the
 * App Router has no way to take over an HTTP `upgrade` event from inside
 * a Route Handler (see `websocket-server.ts`'s own doc comment) — every
 * Next.js app that wants raw WebSockets needs a Node HTTP server that
 * isn't purely `next`'s own CLI. Rather than replace `next start` with a
 * custom server (a real architectural change to how this application
 * boots, and out of scope for "the architecture MUST remain exactly as
 * it is"), this ships as an **additive, optional, independently
 * deployable sidecar process**: `npm run dev`/`build`/`start` are
 * completely unchanged, and this script — reusing the exact same
 * `RealtimeHub` composition (`infrastructure/realtime/compose.ts`) the
 * SSE transport inside Next.js also uses — is only started by an
 * operator who actually wants live WebSocket support in a given
 * deployment. See docs/MODULE_48_REALTIME_SYSTEM.md, "Deployment
 * considerations", for both supported shapes (run as its own service
 * behind e.g. `/realtime` on a reverse proxy, or embedded into a custom
 * Node entry point that also runs Next — this script works either way
 * since it only ever *attaches* to an `http.Server`, never assumes it
 * owns the process).
 *
 * `--conditions=react-server` on the `tsx` invocation is required: this
 * script transitively imports `env.ts`, which imports the `server-only`
 * marker package. Next.js's webpack build sets that resolve condition
 * itself (see env.ts's own doc comment on `server-only`); a plain
 * `tsx`/Node run does not unless told to, so it's passed explicitly here
 * — the identical technique `tests/test-utils/server-only-stub.ts` +
 * `vitest.config.ts`'s alias achieves for the test runner, applied via
 * Node's native conditional-exports mechanism instead of a bundler alias.
 */
async function main(): Promise<void> {
  const server = createServer((_request, response) => {
    response.writeHead(404, { "content-type": "text/plain" });
    response.end("Module 48 realtime gateway: only WebSocket upgrades on /realtime/ws are served here.");
  });

  const wsServer = new RealtimeWebSocketServer(realtimeHub);
  wsServer.attach(server);

  const heartbeatSweep = setInterval(() => {
    const evicted = reapExpiredRealtimeConnections();
    if (evicted > 0) logger.info("realtime_gateway_reaped_stale_connections", { evicted });
  }, env.REALTIME_HEARTBEAT_INTERVAL_MS);

  await new Promise<void>((resolve) => server.listen(env.REALTIME_WS_PORT, resolve));
  logger.info("realtime_gateway_listening", { port: env.REALTIME_WS_PORT });

  const shutdown = async (signal: string): Promise<void> => {
    logger.info("realtime_gateway_shutting_down", { signal });
    clearInterval(heartbeatSweep);
    await new Promise<void>((resolve) => server.close(() => resolve()));
    process.exit(0);
  };
  process.on("SIGTERM", () => void shutdown("SIGTERM"));
  process.on("SIGINT", () => void shutdown("SIGINT"));
}

main().catch((error) => {
  logger.error("realtime_gateway_failed_to_start", { error });
  process.exitCode = 1;
});
