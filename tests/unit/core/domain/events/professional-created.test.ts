import { describe, expect, it } from "vitest";

import { ProfessionalCreated } from "@/domain/events/professional-created";

describe("domain/events/professional-created", () => {
  it("declares the stable eventName used for EventBus dispatch", () => {
    expect(ProfessionalCreated.eventName).toBe("professional.created");
  });

  it("carries the professional and user ids", () => {
    const event = new ProfessionalCreated("prof-1", "user-1");
    expect(event.eventName).toBe("professional.created");
    expect(event.professionalId).toBe("prof-1");
    expect(event.userId).toBe("user-1");
    expect(event.eventId).toBeTruthy();
    expect(event.occurredAt).toBeInstanceOf(Date);
  });
});
