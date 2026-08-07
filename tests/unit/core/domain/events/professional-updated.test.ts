import { describe, expect, it } from "vitest";

import { ProfessionalUpdated } from "@/domain/events/professional-updated";

describe("domain/events/professional-updated", () => {
  it("declares the stable eventName used for EventBus dispatch", () => {
    expect(ProfessionalUpdated.eventName).toBe("professional.updated");
  });

  it("defaults reason to 'profile'", () => {
    const event = new ProfessionalUpdated("prof-1");
    expect(event.reason).toBe("profile");
  });

  it("accepts an explicit reason ('categories' or 'status')", () => {
    expect(new ProfessionalUpdated("prof-1", "categories").reason).toBe("categories");
    expect(new ProfessionalUpdated("prof-1", "status").reason).toBe("status");
  });
});
