import { describe, expect, it } from "vitest";

import { DisputeMessageAdded } from "@/domain/events/dispute-message-added";

describe("domain/events/dispute-message-added", () => {
  it("declares the stable eventName used for EventBus dispatch", () => {
    expect(DisputeMessageAdded.eventName).toBe("dispute.message-added");
  });

  it("carries every field a reacting subscriber needs", () => {
    const event = new DisputeMessageAdded("dispute-1", "DSP-2026-000001", "message-1", "user-1", ["user-2", "user-3"]);

    expect(event.eventName).toBe("dispute.message-added");
    expect(event.disputeId).toBe("dispute-1");
    expect(event.caseNumber).toBe("DSP-2026-000001");
    expect(event.messageId).toBe("message-1");
    expect(event.actorUserId).toBe("user-1");
    expect(event.recipientUserIds).toEqual(["user-2", "user-3"]);
    expect(event.eventId).toBeTruthy();
    expect(event.occurredAt).toBeInstanceOf(Date);
  });

  it("allows an empty recipientUserIds list for the defensive job-not-found edge case", () => {
    const event = new DisputeMessageAdded("dispute-1", "DSP-2026-000001", "message-1", "user-1", []);
    expect(event.recipientUserIds).toEqual([]);
  });
});
