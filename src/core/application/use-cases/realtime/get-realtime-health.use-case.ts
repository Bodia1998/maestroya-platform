import type { RealtimeMetricsSnapshot } from "@/application/services/realtime/realtime-metrics";

/**
 * Module 48 — Real-Time System (query).
 *
 * Consumed by `/api/health/ready` (see `infrastructure/realtime/compose.ts`'s
 * `getRealtimeHealth()`, which is what actually wires this against the
 * live singletons — this use case exists so the *shape* of a realtime
 * health report is declared once, independent of DI wiring). Reports are
 * visibility-only, exactly like `checks.cachingLayer`/`checks.searchEngine`
 * — the realtime layer degrading never flips the readiness endpoint's
 * overall status, since every consumer (SSE clients, a WebSocket gateway)
 * has its own reconnect logic already.
 */
export interface RealtimeHealthReport {
  readonly status: "ok" | "degraded";
  readonly transports: {
    readonly sse: "ok";
    readonly websocket: "not_configured" | "ok" | "error";
  };
  readonly activeConnections: number;
  readonly activeChannels: number;
  readonly onlineUsers: number;
  readonly metrics: RealtimeMetricsSnapshot;
}

export class GetRealtimeHealthUseCase {
  constructor(private readonly report: () => RealtimeHealthReport) {}

  execute(): RealtimeHealthReport {
    return this.report();
  }
}
