import { describe, expect, it } from "vitest";

import { CompanyStatusChanged } from "@/domain/events/company-status-changed";

describe("domain/events/company-status-changed", () => {
  it("declares the stable eventName used for EventBus dispatch", () => {
    expect(CompanyStatusChanged.eventName).toBe("company.status-changed");
  });

  it("carries every field a reacting subscriber needs, and exposes it via DomainEvent's eventName getter", () => {
    const event = new CompanyStatusChanged("company-1", "owner-1", "ACTIVE", "SUSPENDED", "admin-1");

    expect(event.eventName).toBe("company.status-changed");
    expect(event.companyId).toBe("company-1");
    expect(event.ownerUserId).toBe("owner-1");
    expect(event.previousStatus).toBe("ACTIVE");
    expect(event.newStatus).toBe("SUSPENDED");
    expect(event.adminUserId).toBe("admin-1");
    expect(event.eventId).toBeTruthy();
    expect(event.occurredAt).toBeInstanceOf(Date);
  });

  it("allows a null adminUserId for a future system-triggered transition", () => {
    const event = new CompanyStatusChanged("company-1", "owner-1", "SUSPENDED", "ACTIVE", null);
    expect(event.adminUserId).toBeNull();
  });
});
