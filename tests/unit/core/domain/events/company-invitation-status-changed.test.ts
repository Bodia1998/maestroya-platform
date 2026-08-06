import { describe, expect, it } from "vitest";

import { CompanyInvitationStatusChanged } from "@/domain/events/company-invitation-status-changed";

describe("domain/events/company-invitation-status-changed", () => {
  it("declares the stable eventName used for EventBus dispatch", () => {
    expect(CompanyInvitationStatusChanged.eventName).toBe("company-invitation.status-changed");
  });

  it("carries every field a reacting subscriber needs for a CREATED transition, and exposes it via DomainEvent's eventName getter", () => {
    const event = new CompanyInvitationStatusChanged(
      "invitation-1",
      "company-1",
      "invitee-1",
      "owner-1",
      "PENDING",
      "CREATED",
      "MEMBER",
      "invitee@example.com",
    );

    expect(event.eventName).toBe("company-invitation.status-changed");
    expect(event.invitationId).toBe("invitation-1");
    expect(event.companyId).toBe("company-1");
    expect(event.recipientUserId).toBe("invitee-1");
    expect(event.actorUserId).toBe("owner-1");
    expect(event.newStatus).toBe("PENDING");
    expect(event.transition).toBe("CREATED");
    expect(event.role).toBe("MEMBER");
    expect(event.email).toBe("invitee@example.com");
    expect(event.eventId).toBeTruthy();
    expect(event.occurredAt).toBeInstanceOf(Date);
  });

  it("defaults role and email to null for transitions that don't record them", () => {
    const event = new CompanyInvitationStatusChanged(
      "invitation-1",
      "company-1",
      "owner-1",
      "invitee-1",
      "DECLINED",
      "DECLINED",
    );
    expect(event.role).toBeNull();
    expect(event.email).toBeNull();
  });

  it("carries role but not email for an ACCEPTED transition", () => {
    const event = new CompanyInvitationStatusChanged(
      "invitation-1",
      "company-1",
      "owner-1",
      "invitee-1",
      "ACCEPTED",
      "ACCEPTED",
      "MANAGER",
    );
    expect(event.role).toBe("MANAGER");
    expect(event.email).toBeNull();
  });

  it("allows a null recipientUserId for the defensive invited-email-has-no-account edge case on CREATED", () => {
    const event = new CompanyInvitationStatusChanged(
      "invitation-1",
      "company-1",
      null,
      "owner-1",
      "PENDING",
      "CREATED",
      "MEMBER",
      "unregistered@example.com",
    );
    expect(event.recipientUserId).toBeNull();
  });
});
