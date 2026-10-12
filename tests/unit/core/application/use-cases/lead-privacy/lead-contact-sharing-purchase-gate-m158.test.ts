import { describe, expect, it, vi } from "vitest";

import { LeadContactSharingPurchaseGate, guardLeadPurchaseByContactSharing } from "@/application/use-cases/lead-privacy/lead-contact-sharing-purchase-gate";
import { LeadNotPurchasableError } from "@/domain/services/lead-purchase";

const rec = (basis: "CONSENT" | "OTHER_LAWFUL_BASIS", withdrawnAt: Date | null = null) => ({
  id: "r", leadId: "l", userId: "u", basis, noticeVersion: "v1", recordedAt: new Date(), withdrawnAt,
});

describe("M158 purchase gate", () => {
  it("undecided policy: allowed and makes no read at all (behaviour unchanged)", async () => {
    const findByLeadId = vi.fn();
    expect(await new LeadContactSharingPurchaseGate({ findByLeadId }, { contactSharingBasis: null }).allowsPurchase("l")).toBe(true);
    expect(findByLeadId).not.toHaveBeenCalled();
  });

  it("CONSENT: needs a non-withdrawn consent record (no silent consent)", async () => {
    const gate = (r: unknown) => new LeadContactSharingPurchaseGate({ findByLeadId: async () => r as never }, { contactSharingBasis: "CONSENT" });
    expect(await gate(null).allowsPurchase("l")).toBe(false);
    expect(await gate(rec("OTHER_LAWFUL_BASIS")).allowsPurchase("l")).toBe(false);
    expect(await gate(rec("CONSENT", new Date())).allowsPurchase("l")).toBe(false);
    expect(await gate(rec("CONSENT")).allowsPurchase("l")).toBe(true);
  });

  it("OTHER_LAWFUL_BASIS: allowed without a record; a withdrawn consent still denies", async () => {
    const gate = (r: unknown) => new LeadContactSharingPurchaseGate({ findByLeadId: async () => r as never }, { contactSharingBasis: "OTHER_LAWFUL_BASIS" });
    expect(await gate(null).allowsPurchase("l")).toBe(true);
    expect(await gate(rec("CONSENT", new Date())).allowsPurchase("l")).toBe(false);
  });

  it("a read failure propagates (fail closed)", async () => {
    const g = new LeadContactSharingPurchaseGate({ findByLeadId: async () => { throw new Error("db"); } }, { contactSharingBasis: "CONSENT" });
    await expect(g.allowsPurchase("l")).rejects.toThrow("db");
  });
});

describe("M158 purchase decorator", () => {
  const LEAD = "11111111-1111-4111-8111-111111111111";
  it("denying gate: uniform LeadNotPurchasableError and the inner use case is never called", async () => {
    const inner = { execute: vi.fn(async () => "ok") };
    const g = guardLeadPurchaseByContactSharing(inner, { allowsPurchase: async () => false });
    await expect(g.execute("u", LEAD)).rejects.toBeInstanceOf(LeadNotPurchasableError);
    expect(inner.execute).not.toHaveBeenCalled();
  });
  it("allowing gate: delegates unchanged; a malformed id is not gated (inner rejects it as before)", async () => {
    const inner = { execute: vi.fn(async () => "ok") };
    const allows = vi.fn(async () => true);
    const g = guardLeadPurchaseByContactSharing(inner, { allowsPurchase: allows });
    expect(await g.execute("u", LEAD)).toBe("ok");
    await g.execute("u", "not-a-uuid");
    expect(allows).toHaveBeenCalledTimes(1);
    expect(inner.execute).toHaveBeenCalledTimes(2);
  });
  it("a gate failure propagates (fail closed) and the inner use case is not called", async () => {
    const inner = { execute: vi.fn() };
    const g = guardLeadPurchaseByContactSharing(inner, { allowsPurchase: async () => { throw new Error("db"); } });
    await expect(g.execute("u", LEAD)).rejects.toThrow("db");
    expect(inner.execute).not.toHaveBeenCalled();
  });
});
