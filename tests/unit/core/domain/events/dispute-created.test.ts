import { describe, expect, it } from "vitest";

import { DisputeCreated } from "@/domain/events/dispute-created";

describe("domain/events/dispute-created", () => {
  it("declares the stable eventName used for EventBus dispatch", () => {
    expect(DisputeCreated.eventName).toBe("dispute.created");
  });

  it("carries every field a reacting subscriber needs", () => {
    const event = new DisputeCreated("dispute-1", "DSP-2026-000001", "job-1", "SERVICE_QUALITY", "user-1", ["user-2"]);

    expect(event.eventName).toBe("dispute.created");
    expect(event.disputeId).toBe("dispute-1");
    expect(event.caseNumber).toBe("DSP-2026-000001");
    expect(event.jobId).toBe("job-1");
    expect(event.reason).toBe("SERVICE_QUALITY");
    expect(event.actorUserId).toBe("user-1");
    expect(event.recipientUserIds).toEqual(["user-2"]);
    expect(event.eventId).toBeTruthy();
    expect(event.occurredAt).toBeInstanceOf(Date);
  });

  it("allows an empty recipientUserIds list for the defensive respondent-not-found edge case", () => {
    const event = new DisputeCreated("dispute-1", "DSP-2026-000001", "job-1", "OTHER", "user-1", []);
    expect(event.recipientUserIds).toEqual([]);
  });
});
