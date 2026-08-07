import { describe, expect, it } from "vitest";

import { CompanyCreated } from "@/domain/events/company-created";

describe("domain/events/company-created", () => {
  it("declares the stable eventName used for EventBus dispatch", () => {
    expect(CompanyCreated.eventName).toBe("company.created");
  });

  it("carries the company and owner ids", () => {
    const event = new CompanyCreated("company-1", "owner-1");
    expect(event.companyId).toBe("company-1");
    expect(event.ownerUserId).toBe("owner-1");
  });
});
