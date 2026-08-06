import { describe, expect, it } from "vitest";

import { DisputeAssigned } from "@/domain/events/dispute-assigned";

describe("domain/events/dispute-assigned", () => {
  it("declares the stable eventName used for EventBus dispatch", () => {
    expect(DisputeAssigned.eventName).toBe("dispute.assigned");
  });

  it("carries every field a reacting subscriber needs", () => {
    const event = new DisputeAssigned("dispute-1", "DSP-2026-000001", "admin-old", "admin-new", "admin-1");

    expect(event.eventName).toBe("dispute.assigned");
    expect(event.disputeId).toBe("dispute-1");
    expect(event.caseNumber).toBe("DSP-2026-000001");
    expect(event.previousAssigneeUserId).toBe("admin-old");
    expect(event.newAssigneeUserId).toBe("admin-new");
    expect(event.actorUserId).toBe("admin-1");
    expect(event.eventId).toBeTruthy();
    expect(event.occurredAt).toBeInstanceOf(Date);
  });

  it("allows a null previousAssigneeUserId (first-time assignment)", () => {
    const event = new DisputeAssigned("dispute-1", "DSP-2026-000001", null, "admin-new", "admin-1");
    expect(event.previousAssigneeUserId).toBeNull();
  });

  it("allows a null newAssigneeUserId (unassignment)", () => {
    const event = new DisputeAssigned("dispute-1", "DSP-2026-000001", "admin-old", null, "admin-1");
    expect(event.newAssigneeUserId).toBeNull();
  });
});
