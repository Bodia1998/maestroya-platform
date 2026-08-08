import { describe, expect, it, vi } from "vitest";

import { BroadcastDomainEventSubscriber } from "@/application/use-cases/realtime/broadcast-domain-event.subscriber";
import { DomainEvent } from "@/domain/events/domain-event";
import type { PublishToChannelUseCase } from "@/application/use-cases/realtime/publish-to-channel.use-case";

class FakeEvent extends DomainEvent {
  static readonly eventName = "fake.event";
  constructor(readonly id: string) {
    super();
  }
}

describe("application/use-cases/realtime/broadcast-domain-event.subscriber", () => {
  it("publishes using the result of mapToChannel", () => {
    const execute = vi.fn();
    const subscriber = new BroadcastDomainEventSubscriber<FakeEvent>({ execute } as unknown as PublishToChannelUseCase, (event) => ({
      channel: `dispute:${event.id}`,
      type: "fake.event",
      payload: { id: event.id },
    }));

    subscriber.handle(new FakeEvent("d1"));

    expect(execute).toHaveBeenCalledWith({ channel: "dispute:d1", type: "fake.event", payload: { id: "d1" } });
  });

  it("does not publish when mapToChannel returns null", () => {
    const execute = vi.fn();
    const subscriber = new BroadcastDomainEventSubscriber<FakeEvent>({ execute } as unknown as PublishToChannelUseCase, () => null);

    subscriber.handle(new FakeEvent("d1"));

    expect(execute).not.toHaveBeenCalled();
  });
});
