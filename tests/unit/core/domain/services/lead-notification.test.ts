import { describe, expect, it } from "vitest";

import {
  LEAD_NOTIFICATION_FACTS,
  LEAD_NOTIFICATION_RECIPIENT_ROLES,
  buildLeadNotificationMetadata,
  customerLeadRequestPath,
  leadNotificationDedupeKey,
  leadNotificationSpec,
  professionalLeadPurchasePath,
} from "@/domain/services/lead-notification";
import { isSafeActionUrl } from "@/domain/services/notification-rules";

/** Module 145 — pure LEAD_V1 notification policy. */
describe("leadNotificationSpec — which (fact, role) pairs notify", () => {
  it("maps exactly the four intended notifications", () => {
    expect(leadNotificationSpec("LEAD_PUBLISHED", "customer")?.type).toBe("LEAD_REQUEST_PUBLISHED");
    expect(leadNotificationSpec("PURCHASE_CONFIRMED", "customer")?.type).toBe("LEAD_PURCHASED");
    expect(leadNotificationSpec("PURCHASE_CONFIRMED", "professional")?.type).toBe("LEAD_PURCHASE_CONFIRMED");
    expect(leadNotificationSpec("PURCHASE_CANCELLED", "professional")?.type).toBe("LEAD_PURCHASE_CANCELLED");
  });

  it("is silent for every other pair (publication never tells a professional; a cancellation never tells the customer)", () => {
    const notifying = LEAD_NOTIFICATION_FACTS.flatMap((fact) =>
      LEAD_NOTIFICATION_RECIPIENT_ROLES.filter((role) => leadNotificationSpec(fact, role) !== null).map((role) => `${fact}:${role}`),
    );
    expect(notifying.sort()).toEqual(
      ["LEAD_PUBLISHED:customer", "PURCHASE_CANCELLED:professional", "PURCHASE_CONFIRMED:customer", "PURCHASE_CONFIRMED:professional"].sort(),
    );
  });

  it("never produces a success type for the cancelled fact", () => {
    for (const role of LEAD_NOTIFICATION_RECIPIENT_ROLES) {
      const spec = leadNotificationSpec("PURCHASE_CANCELLED", role);
      if (spec) expect(spec.type).not.toBe("LEAD_PURCHASE_CONFIRMED");
    }
  });
});

describe("leadNotificationDedupeKey", () => {
  it("is deterministic and distinct per fact, subject and role", () => {
    const base = leadNotificationDedupeKey("PURCHASE_CONFIRMED", "p-1", "professional");
    expect(leadNotificationDedupeKey("PURCHASE_CONFIRMED", "p-1", "professional")).toBe(base);
    expect(leadNotificationDedupeKey("PURCHASE_CONFIRMED", "p-1", "customer")).not.toBe(base);
    expect(leadNotificationDedupeKey("PURCHASE_CONFIRMED", "p-2", "professional")).not.toBe(base);
    expect(leadNotificationDedupeKey("PURCHASE_CANCELLED", "p-1", "professional")).not.toBe(base);
    expect(base).toBe("lead-v1:purchase-confirmed:p-1:professional");
  });

  it("fits the 191-character column for uuid subjects", () => {
    expect(leadNotificationDedupeKey("PURCHASE_CONFIRMED", "11111111-1111-4111-8111-111111111111", "professional").length).toBeLessThan(191);
  });
});

describe("metadata and deep links", () => {
  it("metadata is a whitelist of exactly { city }", () => {
    expect(buildLeadNotificationMetadata({ city: "  Madrid " })).toEqual({ city: "Madrid" });
    expect(Object.keys(buildLeadNotificationMetadata({ city: "x" }))).toEqual(["city"]);
  });

  it("deep links are same-origin safe paths and carry no purchase/payment value", () => {
    const customer = customerLeadRequestPath("22222222-2222-4222-8222-222222222222");
    const professional = professionalLeadPurchasePath("11111111-1111-4111-8111-111111111111");
    expect(isSafeActionUrl(customer)).toBe(true);
    expect(isSafeActionUrl(professional)).toBe(true);
    expect(customer).toBe("/requests/22222222-2222-4222-8222-222222222222");
    expect(professional).toBe("/dashboard/professional/leads/11111111-1111-4111-8111-111111111111/purchase");
  });

  it("encodes hostile ids instead of building an unsafe path", () => {
    expect(isSafeActionUrl(customerLeadRequestPath("//evil.com"))).toBe(true);
    expect(customerLeadRequestPath("//evil.com").startsWith("/requests/")).toBe(true);
    expect(customerLeadRequestPath("//evil.com")).not.toContain("//evil");
  });
});
