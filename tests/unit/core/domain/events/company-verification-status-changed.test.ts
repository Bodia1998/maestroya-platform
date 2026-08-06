import { describe, expect, it } from "vitest";

import { CompanyVerificationStatusChanged } from "@/domain/events/company-verification-status-changed";

describe("domain/events/company-verification-status-changed", () => {
  it("declares the stable eventName used for EventBus dispatch", () => {
    expect(CompanyVerificationStatusChanged.eventName).toBe("company-verification.status-changed");
  });

  it("carries every field a reacting subscriber needs, and exposes it via DomainEvent's eventName getter", () => {
    const event = new CompanyVerificationStatusChanged(
      "verification-1",
      "company-1",
      "owner-1",
      "DRAFT",
      "PENDING",
      "owner-1",
      "SUBMITTED",
      2,
    );

    expect(event.eventName).toBe("company-verification.status-changed");
    expect(event.verificationId).toBe("verification-1");
    expect(event.companyProfileId).toBe("company-1");
    expect(event.recipientUserId).toBe("owner-1");
    expect(event.previousStatus).toBe("DRAFT");
    expect(event.newStatus).toBe("PENDING");
    expect(event.actorUserId).toBe("owner-1");
    expect(event.transition).toBe("SUBMITTED");
    expect(event.documentCount).toBe(2);
    expect(event.eventId).toBeTruthy();
    expect(event.occurredAt).toBeInstanceOf(Date);
  });

  it("defaults documentCount to null for transitions that don't record it", () => {
    const event = new CompanyVerificationStatusChanged(
      "verification-1",
      "company-1",
      "owner-1",
      "PENDING",
      "APPROVED",
      "admin-1",
      "APPROVED",
    );
    expect(event.documentCount).toBeNull();
  });

  it("allows a null recipientUserId for the defensive company-not-found edge case", () => {
    const event = new CompanyVerificationStatusChanged(
      "verification-1",
      "company-1",
      null,
      "PENDING",
      "REJECTED",
      "admin-1",
      "REJECTED",
    );
    expect(event.recipientUserId).toBeNull();
  });
});
