import { describe, expect, it } from "vitest";

import { ProfessionalVerificationStatusChanged } from "@/domain/events/professional-verification-status-changed";

describe("domain/events/professional-verification-status-changed", () => {
  it("declares the stable eventName used for EventBus dispatch", () => {
    expect(ProfessionalVerificationStatusChanged.eventName).toBe("professional-verification.status-changed");
  });

  it("carries every field a reacting subscriber needs, and exposes it via DomainEvent's eventName getter", () => {
    const event = new ProfessionalVerificationStatusChanged(
      "verification-1",
      "profile-1",
      "pro-user-1",
      "DRAFT",
      "PENDING",
      "pro-user-1",
      "SUBMITTED",
      2,
    );

    expect(event.eventName).toBe("professional-verification.status-changed");
    expect(event.verificationId).toBe("verification-1");
    expect(event.professionalProfileId).toBe("profile-1");
    expect(event.professionalUserId).toBe("pro-user-1");
    expect(event.previousStatus).toBe("DRAFT");
    expect(event.newStatus).toBe("PENDING");
    expect(event.actorUserId).toBe("pro-user-1");
    expect(event.transition).toBe("SUBMITTED");
    expect(event.documentCount).toBe(2);
    expect(event.eventId).toBeTruthy();
    expect(event.occurredAt).toBeInstanceOf(Date);
  });

  it("defaults documentCount to null for transitions that don't record it", () => {
    const event = new ProfessionalVerificationStatusChanged(
      "verification-1",
      "profile-1",
      "pro-user-1",
      "PENDING",
      "APPROVED",
      "admin-1",
      "APPROVED",
    );
    expect(event.documentCount).toBeNull();
  });

  it("allows a null professionalUserId for the defensive profile-not-found edge case", () => {
    const event = new ProfessionalVerificationStatusChanged(
      "verification-1",
      "profile-1",
      null,
      "PENDING",
      "REJECTED",
      "admin-1",
      "REJECTED",
    );
    expect(event.professionalUserId).toBeNull();
  });
});
