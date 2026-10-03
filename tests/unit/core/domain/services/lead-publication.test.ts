import { describe, expect, it } from "vitest";

import {
  LEAD_STATUSES,
  LeadNotPublishableError,
  ServiceRequestNotEligibleForLeadError,
  assertLeadPublishable,
  assertServiceRequestEligibleForLead,
  canPublishLead,
} from "@/domain/services/lead";

describe("Module 124 — Lead publication rules", () => {
  it("only DRAFT may be published", () => {
    for (const status of LEAD_STATUSES) expect(canPublishLead(status)).toBe(status === "DRAFT");
  });

  it.each(["CLOSED", "EXPIRED", "CANCELLED"] as const)("%s cannot be published", (status) => {
    expect(() => assertLeadPublishable(status)).toThrow(LeadNotPublishableError);
  });

  const ok = { status: "PUBLISHED", title: "Fuga", description: "Baño", location: { city: "Madrid" } } as const;

  it("accepts an open, complete request", () => {
    expect(() => assertServiceRequestEligibleForLead(ok)).not.toThrow();
  });

  it.each(["DRAFT", "QUOTED", "ACCEPTED", "IN_PROGRESS", "COMPLETED", "CANCELLED", "EXPIRED", "DISPUTED"] as const)(
    "rejects request status %s",
    (status) => {
      expect(() => assertServiceRequestEligibleForLead({ ...ok, status })).toThrow(ServiceRequestNotEligibleForLeadError);
    },
  );

  it("rejects blank title, description or city", () => {
    for (const patch of [{ title: " " }, { description: "" }, { location: { city: "  " } }]) {
      expect(() => assertServiceRequestEligibleForLead({ ...ok, ...patch })).toThrow(ServiceRequestNotEligibleForLeadError);
    }
  });
});
