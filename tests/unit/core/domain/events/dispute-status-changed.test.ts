import { describe, expect, it } from "vitest";

import { DisputeStatusChanged } from "@/domain/events/dispute-status-changed";

describe("domain/events/dispute-status-changed", () => {
  it("declares the stable eventName used for EventBus dispatch", () => {
    expect(DisputeStatusChanged.eventName).toBe("dispute.status-changed");
  });

  it("carries every field a reacting subscriber needs, and exposes it via DomainEvent's eventName getter", () => {
    const event = new DisputeStatusChanged(
      "dispute-1",
      "DSP-2026-000001",
      "UNDER_REVIEW",
      "RESOLVED",
      "admin-1",
      "RESOLVED",
      ["user-1", "user-2"],
      "PARTIAL_RESOLUTION",
    );

    expect(event.eventName).toBe("dispute.status-changed");
    expect(event.disputeId).toBe("dispute-1");
    expect(event.caseNumber).toBe("DSP-2026-000001");
    expect(event.previousStatus).toBe("UNDER_REVIEW");
    expect(event.newStatus).toBe("RESOLVED");
    expect(event.actorUserId).toBe("admin-1");
    expect(event.transition).toBe("RESOLVED");
    expect(event.recipientUserIds).toEqual(["user-1", "user-2"]);
    expect(event.resolution).toBe("PARTIAL_RESOLUTION");
    expect(event.eventId).toBeTruthy();
    expect(event.occurredAt).toBeInstanceOf(Date);
  });

  it("defaults resolution to null for transitions that don't record one", () => {
    const event = new DisputeStatusChanged(
      "dispute-1",
      "DSP-2026-000001",
      "UNDER_REVIEW",
      "REJECTED",
      "admin-1",
      "REJECTED",
      ["user-1"],
    );
    expect(event.resolution).toBeNull();
  });

  it("allows an empty recipientUserIds list for the defensive job-not-found edge case", () => {
    const event = new DisputeStatusChanged(
      "dispute-1",
      "DSP-2026-000001",
      "OPEN",
      "UNDER_REVIEW",
      "admin-1",
      "STATUS_CHANGED",
      [],
    );
    expect(event.recipientUserIds).toEqual([]);
  });
});
