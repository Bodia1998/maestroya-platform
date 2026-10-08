import { describe, expect, it, vi } from "vitest";

import { toLeadPurchaseCheckoutDto } from "@/application/dto/lead-purchase-checkout.dto";
import type { LeadContactAuthorizationReader, LeadContactReader, LeadContactRecord } from "@/application/ports/lead-contact-access";
import { GetLeadContactUseCase } from "@/application/use-cases/lead-contact/get-lead-contact.use-case";
import { GetLeadPurchaseCheckoutUseCase } from "@/application/use-cases/lead-checkout/get-lead-purchase-checkout.use-case";
import type { LeadPurchaseLatestReader, LeadPurchaseRecord } from "@/domain/repositories/lead-purchase-repository";
import type { LeadRepository } from "@/domain/repositories/lead-repository";
import type { ProfessionalRepository } from "@/domain/repositories/professional-repository";
import type { UserRepository } from "@/domain/repositories/user-repository";
import { LeadContactAccessDeniedError, type LeadContactAuthorizationFacts } from "@/domain/services/lead-contact-access-policy";
import { LEAD_PURCHASE_STATUSES, toLeadContactGrantState, type LeadPurchaseStatus } from "@/domain/services/lead-purchase";

import { SNAPSHOT_DATA } from "../../../../../test-utils/lead-publication-fixtures";
import { pendingPurchaseFromPublication } from "../../../../../test-utils/lead-purchase-fixtures";
import { M139_SECRET_EMAIL, M139_SENTINELS, assertNoContactLeak } from "../../../../../test-utils/contact-leak-sentinels";

vi.mock("@/infrastructure/observability/logger", () => ({
  logger: { warn: vi.fn(), info: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

const LEAD = "11111111-1111-4111-8111-111111111111";
const OTHER_LEAD = "66666666-6666-4666-8666-666666666666";
const USER_A = "22222222-2222-4222-8222-222222222222";
const USER_B = "77777777-7777-4777-8777-777777777777";
const PRO_A = "33333333-3333-4333-8333-333333333333";
const PRO_B = "44444444-4444-4444-8444-444444444444";
const PURCHASE = "55555555-5555-4555-8555-555555555555";
const PUBLICATION = { ...SNAPSHOT_DATA, price: "100.00", publishedAt: new Date("2026-10-01T00:00:00Z") };

const CONTACT: LeadContactRecord = {
  customerDisplayName: "M139 Secret Customer Name",
  email: M139_SECRET_EMAIL,
  phone: "+34600009999",
  addressLine1: "M139_SECRET_ADDRESS",
  addressLine2: null,
  postalCode: "M139-99999",
  city: "Madrid",
  province: "Madrid",
};

interface WorldOptions {
  purchases?: LeadPurchaseRecord[];
  flow?: "LEAD_V1" | "LEGACY_QUOTE_PAYMENT";
  leadDeleted?: boolean;
  leadMissing?: boolean;
}

/** One in-memory "database" feeding the REAL M144 read use case and the REAL M138 contact use case. */
function world(opts: WorldOptions = {}) {
  const purchases = opts.purchases ?? [];
  const latest: LeadPurchaseLatestReader = {
    findLatestByLeadAndProfessional: vi.fn(async (leadId: string, pro: string) => {
      const rows = purchases.filter((p) => p.leadId === leadId && p.professionalProfileId === pro);
      return rows.length ? structuredClone(rows[rows.length - 1]!) : null;
    }),
  };
  const professionals = {
    findByUserId: vi.fn(async (userId: string) =>
      userId === USER_A ? { id: PRO_A, status: "ACTIVE" } : userId === USER_B ? { id: PRO_B, status: "ACTIVE" } : null,
    ),
  } as unknown as ProfessionalRepository;
  const leads = {
    findById: vi.fn(async (id: string) => (opts.leadMissing || id !== LEAD ? null : { id, flowVersion: opts.flow ?? "LEAD_V1" })),
  } as unknown as LeadRepository;

  const authorization: LeadContactAuthorizationReader = {
    findFacts: vi.fn(async (leadId: string, pro: string) => {
      if (leadId !== LEAD || opts.leadMissing) return null;
      const own = purchases.filter((p) => p.leadId === leadId && p.professionalProfileId === pro);
      const row = own.find((p) => p.status === "CONFIRMED") ?? own[own.length - 1];
      return {
        leadExists: true,
        flowVersion: opts.flow ?? "LEAD_V1",
        blocked: Boolean(opts.leadDeleted),
        contactOwnershipConsistent: true,
        grant: row ? { state: toLeadContactGrantState(row.status), professionalProfileId: row.professionalProfileId } : null,
      } satisfies LeadContactAuthorizationFacts;
    }),
  };
  const contacts: LeadContactReader = { readContact: vi.fn(async () => CONTACT) };
  const users = { findById: vi.fn(async (id: string) => ({ id, status: "ACTIVE" })) } as unknown as UserRepository;

  return {
    checkout: new GetLeadPurchaseCheckoutUseCase(professionals, leads, latest),
    contact: new GetLeadContactUseCase(users, professionals, authorization, contacts),
    latest,
    contacts,
  };
}

function purchase(status: LeadPurchaseStatus, pro = PRO_A, lead = LEAD, id = PURCHASE): LeadPurchaseRecord {
  return { ...pendingPurchaseFromPublication(id, lead, pro, PUBLICATION), status, paymentReference: "pi_SECRET_REFERENCE" };
}

const denied = async (p: Promise<unknown>) => expect(await p.then(() => null, (e: unknown) => e)).toBeInstanceOf(LeadContactAccessDeniedError);

describe("M144 — GetLeadPurchaseCheckoutUseCase (authoritative read)", () => {
  it("returns the caller's own purchase with the persisted snapshot strings untouched", async () => {
    const record = purchase("PENDING_PAYMENT");
    const { checkout } = world({ purchases: [record] });
    const dto = await checkout.execute(USER_A, LEAD);
    expect(dto).toEqual({
      purchaseId: PURCHASE,
      leadId: LEAD,
      status: "PENDING_PAYMENT",
      feeAmount: record.financialSnapshot.feeAmount,
      taxAmount: record.financialSnapshot.taxAmount,
      totalAmount: record.financialSnapshot.totalAmount,
      currency: record.financialSnapshot.currency,
    });
  });

  it("passes the exact stored amounts through even if they are not what a calculation would give (no recomputation)", () => {
    const record = purchase("PENDING_PAYMENT");
    record.financialSnapshot = { ...record.financialSnapshot, feeAmount: "10.00", taxAmount: "7.77", totalAmount: "99.99" };
    const dto = toLeadPurchaseCheckoutDto(record);
    expect([dto.feeAmount, dto.taxAmount, dto.totalAmount]).toEqual(["10.00", "7.77", "99.99"]);
  });

  it("exposes a strict whitelist: no payment reference, professional id, customer data or provenance", async () => {
    const { checkout } = world({ purchases: [purchase("CONFIRMED")] });
    const dto = await checkout.execute(USER_A, LEAD);
    expect(Object.keys(dto!).sort()).toEqual(["currency", "feeAmount", "leadId", "purchaseId", "status", "taxAmount", "totalAmount"]);
    const json = JSON.stringify(dto);
    expect(json).not.toMatch(/pi_SECRET_REFERENCE|paymentReference|professionalProfileId|pricingConfigVersion|taxPolicyVersion/);
    assertNoContactLeak(dto);
  });

  it("reports the LATEST purchase in any status (so a reload recovers FAILED / CANCELLED too)", async () => {
    for (const status of LEAD_PURCHASE_STATUSES) {
      const { checkout } = world({ purchases: [purchase(status)] });
      expect((await checkout.execute(USER_A, LEAD))?.status).toBe(status);
    }
  });

  it("never returns another professional's purchase, a purchase of another lead, or anything for a non-professional", async () => {
    const { checkout } = world({ purchases: [purchase("CONFIRMED", PRO_B), purchase("CONFIRMED", PRO_A, OTHER_LEAD, "88888888-8888-4888-8888-888888888888")] });
    expect(await checkout.execute(USER_A, LEAD)).toBeNull();
    expect(await checkout.execute("99999999-9999-4999-8999-999999999999", LEAD)).toBeNull();
  });

  it.each(["", "not-a-uuid", "1", "' OR 1=1 --"])("rejects a malformed lead id %j without querying", async (id) => {
    const { checkout, latest } = world({ purchases: [purchase("CONFIRMED")] });
    expect(await checkout.execute(USER_A, id)).toBeNull();
    expect(latest.findLatestByLeadAndProfessional).not.toHaveBeenCalled();
  });

  it("returns nothing for a legacy-flow or missing lead", async () => {
    expect(await world({ purchases: [purchase("CONFIRMED")], flow: "LEGACY_QUOTE_PAYMENT" }).checkout.execute(USER_A, LEAD)).toBeNull();
    expect(await world({ purchases: [purchase("CONFIRMED")], leadMissing: true }).checkout.execute(USER_A, LEAD)).toBeNull();
  });

  it("is a pure read: the reader port has no write operation", () => {
    const { latest } = world();
    expect(Object.keys(latest)).toEqual(["findLatestByLeadAndProfessional"]);
  });
});

describe("M144 — contact stays behind M138 (authoritative status gates it)", () => {
  it.each(LEAD_PURCHASE_STATUSES.filter((s) => s !== "CONFIRMED"))("no contact while the purchase is %s (checkout read says so too)", async (status) => {
    const { checkout, contact, contacts } = world({ purchases: [purchase(status)] });
    expect((await checkout.execute(USER_A, LEAD))?.status).toBe(status);
    await denied(contact.execute(USER_A, LEAD));
    expect(contacts.readContact).not.toHaveBeenCalled();
  });

  it("contact is available only once the purchase is CONFIRMED, and only the M138 DTO comes back", async () => {
    const { checkout, contact } = world({ purchases: [purchase("CONFIRMED")] });
    expect((await checkout.execute(USER_A, LEAD))?.status).toBe("CONFIRMED");
    const result = await contact.execute(USER_A, LEAD);
    expect(Object.keys(result).sort()).toEqual(["address", "customerDisplayName", "email", "leadId", "phone"]);
    expect(result.email).toBe(M139_SECRET_EMAIL);
  });

  it("the checkout read of a CONFIRMED purchase contains no contact data", async () => {
    const { checkout } = world({ purchases: [purchase("CONFIRMED")] });
    const json = JSON.stringify(await checkout.execute(USER_A, LEAD));
    for (const secret of M139_SENTINELS) expect(json).not.toContain(secret);
  });

  it("a wrong professional is rejected (someone else's CONFIRMED purchase)", async () => {
    const { contact, contacts } = world({ purchases: [purchase("CONFIRMED", PRO_B)] });
    await denied(contact.execute(USER_A, LEAD));
    expect(contacts.readContact).not.toHaveBeenCalled();
  });

  it("a wrong lead is rejected (confirmed purchase belongs to another lead)", async () => {
    const { contact } = world({ purchases: [purchase("CONFIRMED", PRO_A, OTHER_LEAD, "88888888-8888-4888-8888-888888888888")] });
    await denied(contact.execute(USER_A, OTHER_LEAD));
    await denied(contact.execute(USER_A, LEAD));
  });

  it("a deleted / blocked lead is rejected even with a CONFIRMED purchase", async () => {
    const { contact } = world({ purchases: [purchase("CONFIRMED")], leadDeleted: true });
    await denied(contact.execute(USER_A, LEAD));
  });

  it("a missing lead is rejected", async () => {
    const { contact } = world({ purchases: [purchase("CONFIRMED")], leadMissing: true });
    await denied(contact.execute(USER_A, LEAD));
  });

  it("the legacy flow never exposes contact, whatever the purchase says", async () => {
    const { contact } = world({ purchases: [purchase("CONFIRMED")], flow: "LEGACY_QUOTE_PAYMENT" });
    await denied(contact.execute(USER_A, LEAD));
  });

  it("a professional who only has PENDING_PAYMENT never gets contact, even if the lead has a confirmed buyer", async () => {
    const { contact } = world({ purchases: [purchase("CONFIRMED", PRO_B), purchase("PENDING_PAYMENT", PRO_A, LEAD, "99999999-9999-4999-8999-999999999990")] });
    await denied(contact.execute(USER_A, LEAD));
    await expect(contact.execute(USER_B, LEAD)).resolves.toMatchObject({ leadId: LEAD });
  });
});
