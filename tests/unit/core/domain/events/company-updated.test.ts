import { describe, expect, it } from "vitest";

import { CompanyUpdated } from "@/domain/events/company-updated";

describe("domain/events/company-updated", () => {
  it("declares the stable eventName used for EventBus dispatch", () => {
    expect(CompanyUpdated.eventName).toBe("company.updated");
  });

  it("defaults reason to 'profile' and accepts 'categories'/'status'", () => {
    expect(new CompanyUpdated("company-1").reason).toBe("profile");
    expect(new CompanyUpdated("company-1", "categories").reason).toBe("categories");
    expect(new CompanyUpdated("company-1", "status").reason).toBe("status");
  });
});
