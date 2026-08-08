import type { RealtimeOutboundEvent, RealtimeSink } from "@/application/ports/realtime-registry";

/**
 * Module 48 — Real-Time System.
 *
 * Wraps a Next.js Route Handler's `ReadableStreamDefaultController` as a
 * `RealtimeSink` — the adapter that lets `RealtimeHub` push events to a
 * browser `EventSource` without knowing anything about Next.js or the
 * Fetch Streams API. `src/app/api/realtime/sse/route.ts` is the only
 * caller; kept here (infrastructure layer) rather than inline in the
 * route handler so it can be unit-tested without constructing a real
 * `Response`/`ReadableStream`.
 *
 * Encodes events using the standard Server-Sent Events wire format:
 * `event: <type>\nid: <id>\ndata: <json>\n\n`. A bare `: heartbeat\n\n`
 * comment line (no `event`/`data`) is the SSE-idiomatic keep-alive —
 * ignored by `EventSource` but keeps the underlying HTTP connection (and
 * any intermediary proxy/load balancer's idle timeout) alive, which is
 * this module's "heartbeat" requirement for the SSE transport.
 */
export class SseSink implements RealtimeSink {
  private closed = false;

  constructor(
    private readonly controller: ReadableStreamDefaultController<Uint8Array>,
    private readonly onClose: (reason?: string) => void,
  ) {}

  send(event: RealtimeOutboundEvent): void {
    if (this.closed) return;
    const frame = encodeSseEvent(event);
    try {
      this.controller.enqueue(new TextEncoder().encode(frame));
    } catch {
      // Controller already closed on the client side (browser navigated
      // away, tab closed) — treat as a clean disconnect, never throw back
      // into RealtimeHub.publish's delivery loop.
      this.close("controller_closed");
    }
  }

  sendHeartbeat(): void {
    if (this.closed) return;
    try {
      this.controller.enqueue(new TextEncoder().encode(": heartbeat\n\n"));
    } catch {
      this.close("controller_closed");
    }
  }

  close(reason?: string): void {
    if (this.closed) return;
    this.closed = true;
    try {
      this.controller.close();
    } catch {
      // Already closed — idempotent by design (see interface doc comment).
    }
    this.onClose(reason);
  }
}

export function encodeSseEvent(event: RealtimeOutboundEvent): string {
  const data = JSON.stringify({ channel: event.channel, payload: event.payload, occurredAt: event.occurredAt });
  return `event: ${event.type}\nid: ${event.id}\ndata: ${data}\n\n`;
}
