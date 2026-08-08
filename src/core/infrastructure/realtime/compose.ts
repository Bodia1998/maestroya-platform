import "server-only";

import { env } from "@/infrastructure/config/env";
import { RealtimeHub } from "@/application/services/realtime/realtime-hub";
import { RealtimeMetrics } from "@/application/services/realtime/realtime-metrics";
import { ChannelAuthorizationService } from "@/application/services/realtime/channel-authorization.service";
import type { RealtimeHealthReport } from "@/application/use-cases/realtime/get-realtime-health.use-case";
import { InMemoryConnectionRegistry } from "@/infrastructure/realtime/in-memory-connection-registry";
import { InMemoryPresenceStore } from "@/infrastructure/realtime/in-memory-presence-store";
import { PrismaRealtimeAccessChecker } from "@/infrastructure/realtime/prisma-realtime-access-checker";
import { PrismaJobRepository } from "@/infrastructure/database/prisma/repositories/prisma-job-repository";
import { PrismaCustomerProfileRepository } from "@/infrastructure/database/prisma/repositories/prisma-customer-profile-repository";
import { PrismaProfessionalRepository } from "@/infrastructure/database/prisma/repositories/prisma-professional-repository";
import { PrismaCompanyMembershipRepository } from "@/infrastructure/database/prisma/repositories/prisma-company-membership-repository";
import { PrismaDisputeRepository } from "@/infrastructure/database/prisma/repositories/prisma-dispute-repository";
import { PrismaConversationRepository } from "@/infrastructure/database/prisma/repositories/prisma-conversation-repository";

/**
 * Module 48 — Real-Time System.
 *
 * Composition root for the realtime layer — the same manual, no-DI-
 * container convention as every other `compose.ts` in this codebase (see
 * `infrastructure/jobs/compose.ts`, `infrastructure/events/compose.ts`).
 * A single module-level `RealtimeHub` singleton is constructed here and
 * reused by:
 *
 *   - `src/app/api/realtime/sse/route.ts` (the SSE transport)
 *   - `scripts/realtime-gateway.ts` → `RealtimeWebSocketServer` (the
 *     WebSocket transport)
 *   - `infrastructure/notifications/channels/realtime-notification-channel.ts`
 *     (publishes existing notifications onto `user:{id}` channels)
 *   - `application/use-cases/realtime/compose.ts` (domain-event → channel
 *     subscribers)
 *   - `/api/health/ready` (via `getRealtimeHealth`)
 *
 * Today's registry/presence store are the in-memory implementations —
 * correct for a single instance. See
 * `docs/MODULE_48_REALTIME_SYSTEM.md`'s "Scaling strategy" / "Redis
 * pub/sub readiness" sections for exactly what changes (and, just as
 * importantly, what does *not* — every use case and the `RealtimeHub`
 * itself are already written against the `ConnectionRegistry`/
 * `PresenceStore` ports, so swapping the in-memory implementations for
 * Redis-backed ones later is additive, not a rewrite) to run this behind
 * a load balancer with more than one instance.
 */
const registry = new InMemoryConnectionRegistry();
const presence = new InMemoryPresenceStore();
const metrics = new RealtimeMetrics();

const accessChecker = new PrismaRealtimeAccessChecker(
  new PrismaJobRepository(),
  new PrismaCustomerProfileRepository(),
  new PrismaProfessionalRepository(),
  new PrismaCompanyMembershipRepository(),
  new PrismaDisputeRepository(),
  new PrismaConversationRepository(),
);
const authorization = new ChannelAuthorizationService(accessChecker);

export const realtimeHub = new RealtimeHub(registry, presence, authorization, metrics);

export function getRealtimeHealth(): RealtimeHealthReport {
  const activeConnections = registry.count();
  const activeChannels = new Set(registry.list().flatMap((connection) => [...connection.channels])).size;

  return {
    status: "ok",
    transports: {
      sse: "ok",
      websocket: env.REALTIME_WS_ENABLED === "true" ? "ok" : "not_configured",
    },
    activeConnections,
    activeChannels,
    onlineUsers: presence.listOnlineUserIds().length,
    metrics: metrics.snapshot(activeConnections),
  };
}

/** Periodic sweep for connections whose transport never signalled a clean close (heartbeat timeout) — call from a `setInterval` in each process that owns connections (the Next.js server for SSE, the gateway process for WebSockets). Not started automatically here, so tests and short-lived serverless invocations never get a dangling timer. */
export function reapExpiredRealtimeConnections(now: Date = new Date()): number {
  return realtimeHub.reapExpired(env.REALTIME_CONNECTION_TTL_MS, now);
}

/** Exposed for tests only. */
export const __testing = {
  registry,
  presence,
  metrics,
};
