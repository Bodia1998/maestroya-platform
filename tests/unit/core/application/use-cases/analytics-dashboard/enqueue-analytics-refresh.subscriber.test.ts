import { describe, expect, it, vi } from "vitest";

import { ProfessionalCreated } from "@/domain/events/professional-created";
import type { AnalyticsRefreshQueue } from "@/application/ports/analytics-refresh-queue";
import { nullAnalyticsObserver, type AnalyticsObserver } from "@/application/ports/analytics-observer";
import { EnqueueAnalyticsRefreshSubscriber } from "@/application/use-cases/analytics-dashboard/enqueue-analytics-refresh.subscriber";

describe("application/use-cases/analytics-dashboard/enqueue-analytics-refresh.subscriber", () => {
  it("enqueues a coalesced refresh request carrying the reason and the event id — never recomputes inline", async () => {
    const queue: AnalyticsRefreshQueue = { enqueue: vi.fn().mockResolvedValue(undefined) };
    const subscriber = new EnqueueAnalyticsRefreshSubscriber(queue, "professional.created");
    const event = new ProfessionalCreated("prof-1", "user-1");

    await subscriber.handle(event);

    expect(queue.enqueue).toHaveBeenCalledWith({ reason: "professional.created", eventId: event.eventId });
    // Structural guarantee: the subscriber has no way to reach a
    // Postgres-hitting collaborator — only `queue.enqueue` was called.
    expect(queue.enqueue).toHaveBeenCalledTimes(1);
  });

  it("a failed enqueue is swallowed and reported, never rethrown", async () => {
    const failure = new Error("queue store down");
    const queue: AnalyticsRefreshQueue = { enqueue: vi.fn().mockRejectedValue(failure) };
    const onRefreshFailed = vi.fn();
    const observer: AnalyticsObserver = { ...nullAnalyticsObserver, onRefreshFailed };
    const subscriber = new EnqueueAnalyticsRefreshSubscriber(queue, "professional.created", observer);

    await expect(subscriber.handle(new ProfessionalCreated("prof-1", "user-1"))).resolves.toBeUndefined();
    expect(onRefreshFailed).toHaveBeenCalledWith(
      expect.objectContaining({ trigger: "event", reason: "professional.created", error: failure }),
    );
  });
});
