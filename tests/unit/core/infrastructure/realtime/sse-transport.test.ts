import { describe, expect, it, vi } from "vitest";

import { encodeSseEvent, SseSink } from "@/infrastructure/realtime/sse-transport";

function makeController() {
  const enqueued: Uint8Array[] = [];
  let closed = false;
  return {
    enqueued,
    isClosed: () => closed,
    controller: {
      enqueue: (chunk: Uint8Array) => {
        if (closed) throw new Error("controller already closed");
        enqueued.push(chunk);
      },
      close: () => {
        closed = true;
      },
    } as unknown as ReadableStreamDefaultController<Uint8Array>,
  };
}

describe("infrastructure/realtime/sse-transport", () => {
  it("encodeSseEvent formats the standard SSE wire frame", () => {
    const frame = encodeSseEvent({ id: "e1", type: "dispute.created", channel: "dispute:1", payload: { a: 1 }, occurredAt: "2026-01-01T00:00:00.000Z" });
    expect(frame).toBe('event: dispute.created\nid: e1\ndata: {"channel":"dispute:1","payload":{"a":1},"occurredAt":"2026-01-01T00:00:00.000Z"}\n\n');
  });

  it("send() enqueues the encoded event onto the controller", () => {
    const { controller, enqueued } = makeController();
    const onClose = vi.fn();
    const sink = new SseSink(controller, onClose);

    sink.send({ id: "e1", type: "test", channel: "chat:1", payload: {}, occurredAt: new Date().toISOString() });

    expect(enqueued).toHaveLength(1);
    expect(new TextDecoder().decode(enqueued[0])).toContain("event: test");
  });

  it("sendHeartbeat() enqueues a bare comment line", () => {
    const { controller, enqueued } = makeController();
    const sink = new SseSink(controller, vi.fn());

    sink.sendHeartbeat();

    expect(new TextDecoder().decode(enqueued[0])).toBe(": heartbeat\n\n");
  });

  it("close() is idempotent and invokes onClose exactly once", () => {
    const { controller, isClosed } = makeController();
    const onClose = vi.fn();
    const sink = new SseSink(controller, onClose);

    sink.close("done");
    sink.close("done-again");

    expect(isClosed()).toBe(true);
    expect(onClose).toHaveBeenCalledTimes(1);
    expect(onClose).toHaveBeenCalledWith("done");
  });

  it("send() after close() is a silent no-op", () => {
    const { controller, enqueued } = makeController();
    const sink = new SseSink(controller, vi.fn());
    sink.close();

    sink.send({ id: "e1", type: "test", channel: "chat:1", payload: {}, occurredAt: new Date().toISOString() });

    expect(enqueued).toHaveLength(0);
  });

  it("send() closes the sink instead of throwing when the controller is already closed", () => {
    const { controller } = makeController();
    const onClose = vi.fn();
    const sink = new SseSink(controller, onClose);
    controller.close(); // simulate the client having gone away

    expect(() => sink.send({ id: "e1", type: "test", channel: "chat:1", payload: {}, occurredAt: new Date().toISOString() })).not.toThrow();
    expect(onClose).toHaveBeenCalledWith("controller_closed");
  });
});
