import { describe, expect, it, vi } from "vitest";

import { ProfessionalCreated } from "@/domain/events/professional-created";
import type { SearchIndexQueue } from "@/application/ports/search-index-queue";
import { nullSearchObserver, type SearchObserver } from "@/application/ports/search-observer";
import { EnqueueSearchIndexSubscriber } from "@/application/use-cases/search-indexing/enqueue-search-index.subscriber";

describe("application/use-cases/search-indexing/enqueue-search-index.subscriber", () => {
  it("extracts a request from the event and enqueues it with the event's id/name", async () => {
    const queue: SearchIndexQueue = { enqueue: vi.fn().mockResolvedValue(undefined) };
    const subscriber = new EnqueueSearchIndexSubscriber<ProfessionalCreated>(queue, (event) => ({
      operation: "index",
      kind: "PROFESSIONAL",
      entityId: event.professionalId,
    }));
    const event = new ProfessionalCreated("prof-1", "user-1");

    await subscriber.handle(event);

    expect(queue.enqueue).toHaveBeenCalledWith({
      operation: "index",
      kind: "PROFESSIONAL",
      entityId: "prof-1",
      eventId: event.eventId,
      reason: event.eventName,
    });
  });

  it("enqueues nothing when extract returns null", async () => {
    const queue: SearchIndexQueue = { enqueue: vi.fn() };
    const subscriber = new EnqueueSearchIndexSubscriber<ProfessionalCreated>(queue, () => null);

    await subscriber.handle(new ProfessionalCreated("prof-1", "user-1"));

    expect(queue.enqueue).not.toHaveBeenCalled();
  });

  it("a failed enqueue is swallowed and reported, never rethrown", async () => {
    const failure = new Error("queue store down");
    const queue: SearchIndexQueue = { enqueue: vi.fn().mockRejectedValue(failure) };
    const onError = vi.fn();
    const observer: SearchObserver = { ...nullSearchObserver, onError };
    const subscriber = new EnqueueSearchIndexSubscriber<ProfessionalCreated>(
      queue,
      (event) => ({ operation: "index", kind: "PROFESSIONAL", entityId: event.professionalId }),
      observer,
    );

    await expect(subscriber.handle(new ProfessionalCreated("prof-1", "user-1"))).resolves.toBeUndefined();
    expect(onError).toHaveBeenCalledWith(expect.objectContaining({ operation: "enqueue", error: failure }));
  });

  it("uses the request's own reason over the event name when supplied", async () => {
    const queue: SearchIndexQueue = { enqueue: vi.fn().mockResolvedValue(undefined) };
    const subscriber = new EnqueueSearchIndexSubscriber<ProfessionalCreated>(queue, (event) => ({
      operation: "delete",
      kind: "PROFESSIONAL",
      entityId: event.professionalId,
      reason: "custom-reason",
    }));

    await subscriber.handle(new ProfessionalCreated("prof-1", "user-1"));

    expect(queue.enqueue).toHaveBeenCalledWith(expect.objectContaining({ reason: "custom-reason" }));
  });
});
