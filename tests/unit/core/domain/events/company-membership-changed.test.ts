import { describe, expect, it } from "vitest";

import { CompanyMembershipChanged } from "@/domain/events/company-membership-changed";

describe("domain/events/company-membership-changed", () => {
  it("declares the stable eventName used for EventBus dispatch", () => {
    expect(CompanyMembershipChanged.eventName).toBe("company-membership.changed");
  });

  it("carries every field a reacting subscriber needs for a ROLE_CHANGED transition", () => {
    const event = new CompanyMembershipChanged(
      "company-1",
      "member-1",
      "user-1",
      "owner-1",
      "ROLE_CHANGED",
      "MEMBER",
      "MANAGER",
    );

    expect(event.eventName).toBe("company-membership.changed");
    expect(event.companyId).toBe("company-1");
    expect(event.memberId).toBe("member-1");
    expect(event.targetUserId).toBe("user-1");
    expect(event.actorUserId).toBe("owner-1");
    expect(event.transition).toBe("ROLE_CHANGED");
    expect(event.previousRole).toBe("MEMBER");
    expect(event.newRole).toBe("MANAGER");
    expect(event.selfRemoval).toBeNull();
    expect(event.eventId).toBeTruthy();
    expect(event.occurredAt).toBeInstanceOf(Date);
  });

  it("carries previousRole and selfRemoval but a null newRole for a REMOVED transition", () => {
    const event = new CompanyMembershipChanged(
      "company-1",
      "member-1",
      "user-1",
      "owner-1",
      "REMOVED",
      "MEMBER",
      null,
      false,
    );

    expect(event.previousRole).toBe("MEMBER");
    expect(event.newRole).toBeNull();
    expect(event.selfRemoval).toBe(false);
  });

  it("records selfRemoval true when a member removed themself", () => {
    const event = new CompanyMembershipChanged(
      "company-1",
      "member-1",
      "user-1",
      "user-1",
      "REMOVED",
      "MEMBER",
      null,
      true,
    );

    expect(event.actorUserId).toBe(event.targetUserId);
    expect(event.selfRemoval).toBe(true);
  });

  it("defaults previousRole, newRole and selfRemoval to null for an OWNERSHIP_TRANSFERRED transition", () => {
    const event = new CompanyMembershipChanged("company-1", "member-2", "new-owner-1", "old-owner-1", "OWNERSHIP_TRANSFERRED");

    expect(event.previousRole).toBeNull();
    expect(event.newRole).toBeNull();
    expect(event.selfRemoval).toBeNull();
    expect(event.transition).toBe("OWNERSHIP_TRANSFERRED");
  });
});
