/**
 * Module 48 — Real-Time System.
 *
 * In-process counters for the realtime layer's own observability
 * (connection counts, broadcast fan-out, failed deliveries) — the
 * "metrics" and "connection/broadcast statistics" this module's
 * observability requirement asks for. There is no metrics backend
 * (Prometheus/StatsD/etc.) anywhere in this codebase to integrate with, so
 * — mirroring how `infrastructure/jobs/queue-health.ts` and
 * `infrastructure/search/search-health.ts` report their own counters —
 * this is a plain in-memory accumulator exposed through the health
 * endpoint (`getRealtimeHealth()`), not a new external dependency.
 *
 * A single instance is process-wide (constructed once in
 * `infrastructure/realtime/compose.ts`), so counts reflect this process's
 * lifetime — restarted on deploy, exactly like every other in-memory
 * counter in this codebase (`InMemoryCacheProvider`'s hit/miss counters,
 * `collectQueueHealth`'s in-memory path).
 */
export interface RealtimeMetricsSnapshot {
  readonly connectionsOpenedTotal: number;
  readonly connectionsClosedTotal: number;
  readonly activeConnections: number;
  readonly broadcastsTotal: number;
  readonly messagesDeliveredTotal: number;
  readonly deliveryFailuresTotal: number;
  readonly connectionsByTransport: Record<string, number>;
}

export class RealtimeMetrics {
  private connectionsOpenedTotal = 0;
  private connectionsClosedTotal = 0;
  private broadcastsTotal = 0;
  private messagesDeliveredTotal = 0;
  private deliveryFailuresTotal = 0;
  private readonly openedByTransport = new Map<string, number>();
  private readonly closedByTransport = new Map<string, number>();

  recordConnectionOpened(transport: string): void {
    this.connectionsOpenedTotal += 1;
    this.openedByTransport.set(transport, (this.openedByTransport.get(transport) ?? 0) + 1);
  }

  recordConnectionClosed(transport: string): void {
    this.connectionsClosedTotal += 1;
    this.closedByTransport.set(transport, (this.closedByTransport.get(transport) ?? 0) + 1);
  }

  recordBroadcast(_channel: string, recipientCount: number): void {
    this.broadcastsTotal += 1;
    this.messagesDeliveredTotal += recipientCount;
  }

  recordDeliveryFailure(_channel: string): void {
    this.deliveryFailuresTotal += 1;
  }

  snapshot(activeConnections: number): RealtimeMetricsSnapshot {
    const connectionsByTransport: Record<string, number> = {};
    for (const transport of new Set([...this.openedByTransport.keys(), ...this.closedByTransport.keys()])) {
      connectionsByTransport[transport] =
        (this.openedByTransport.get(transport) ?? 0) - (this.closedByTransport.get(transport) ?? 0);
    }

    return {
      connectionsOpenedTotal: this.connectionsOpenedTotal,
      connectionsClosedTotal: this.connectionsClosedTotal,
      activeConnections,
      broadcastsTotal: this.broadcastsTotal,
      messagesDeliveredTotal: this.messagesDeliveredTotal,
      deliveryFailuresTotal: this.deliveryFailuresTotal,
      connectionsByTransport,
    };
  }
}
