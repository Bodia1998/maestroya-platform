import { describe, expect, it } from "vitest";

import { SupportTicketStatusChanged } from "@/domain/events/support-ticket-status-changed";

describe("domain/events/support-ticket-status-changed", () => {
  it("declares the stable eventName used for EventBus dispatch", () => {
    expect(SupportTicketStatusChanged.eventName).toBe("support-ticket.status-changed");
  });

  it("carries the assignee fields for an ASSIGNED transition, leaving previous/newStatus null", () => {
    const event = new SupportTicketStatusChanged(
      "ticket-1",
      "TCK-2026-000001",
      "admin-1",
      "assignee-1",
      "ASSIGNED",
      null,
      null,
      null,
      "assignee-1",
    );

    expect(event.eventName).toBe("support-ticket.status-changed");
    expect(event.ticketId).toBe("ticket-1");
    expect(event.ticketNumber).toBe("TCK-2026-000001");
    expect(event.actorUserId).toBe("admin-1");
    expect(event.recipientUserId).toBe("assignee-1");
    expect(event.transition).toBe("ASSIGNED");
    expect(event.previousStatus).toBeNull();
    expect(event.newStatus).toBeNull();
    expect(event.previousAssigneeUserId).toBeNull();
    expect(event.newAssigneeUserId).toBe("assignee-1");
    expect(event.eventId).toBeTruthy();
    expect(event.occurredAt).toBeInstanceOf(Date);
  });

  it("allows a null recipientUserId for an unassignment (ASSIGNED with a null new assignee)", () => {
    const event = new SupportTicketStatusChanged(
      "ticket-1",
      "TCK-2026-000001",
      "admin-1",
      null,
      "ASSIGNED",
      null,
      null,
      "assignee-1",
      null,
    );
    expect(event.recipientUserId).toBeNull();
    expect(event.previousAssigneeUserId).toBe("assignee-1");
    expect(event.newAssigneeUserId).toBeNull();
  });

  it("carries previousStatus/newStatus for a STATUS_CHANGED transition, leaving the assignee fields null", () => {
    const event = new SupportTicketStatusChanged(
      "ticket-1",
      "TCK-2026-000001",
      "admin-1",
      "opener-1",
      "STATUS_CHANGED",
      "OPEN",
      "IN_PROGRESS",
    );

    expect(event.previousStatus).toBe("OPEN");
    expect(event.newStatus).toBe("IN_PROGRESS");
    expect(event.previousAssigneeUserId).toBeNull();
    expect(event.newAssigneeUserId).toBeNull();
  });

  it("carries previousStatus/newStatus for a RESOLVED transition", () => {
    const event = new SupportTicketStatusChanged(
      "ticket-1",
      "TCK-2026-000001",
      "admin-1",
      "opener-1",
      "RESOLVED",
      "IN_PROGRESS",
      "RESOLVED",
    );
    expect(event.previousStatus).toBe("IN_PROGRESS");
    expect(event.newStatus).toBe("RESOLVED");
  });

  it("carries previousStatus/newStatus for a CLOSED transition", () => {
    const event = new SupportTicketStatusChanged(
      "ticket-1",
      "TCK-2026-000001",
      "admin-1",
      "opener-1",
      "CLOSED",
      "RESOLVED",
      "CLOSED",
    );
    expect(event.previousStatus).toBe("RESOLVED");
    expect(event.newStatus).toBe("CLOSED");
  });
});
