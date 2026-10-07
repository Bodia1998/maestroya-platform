import { describe, expect, it, vi } from "vitest";

import { toLeadContactDto } from "@/application/dto/lead-contact.dto";
import { toLeadPurchaseDto } from "@/application/dto/lead-purchase.dto";
import type { LeadContactAuthorizationReader, LeadContactReader, LeadContactRecord } from "@/application/ports/lead-contact-access";
import { GetLeadContactUseCase } from "@/application/use-cases/lead-contact/get-lead-contact.use-case";
import {
  LeadContactAccessDeniedError,
  canProfessionalAccessLeadContact,
  type LeadContactAuthorizationFacts,
} from "@/domain/services/lead-contact-access-policy";
import { LEAD_PURCHASE_STATUSES, toLeadContactGrantState, type LeadPurchaseStatus } from "@/domain/services/lead-purchase";
import type { ProfessionalRepository } from "@/domain/repositories/professional-repository";
import type { UserRepository } from "@/domain/repositories/user-repository";

vi.mock("@/infrastructure/observability/logger", () => ({
  logger: { warn: vi.fn(), info: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

const LEAD = "11111111-1111-4111-8111-111111111111";
const OTHER_LEAD = "66666666-6666-4666-8666-666666666666";
const USER_A = "22222222-2222-4222-8222-222222222222";
const USER_B = "77777777-7777-4777-8777-777777777777";
const PRO_A = "33333333-3333-4333-8333-333333333333";
const PRO_B = "44444444-4444-4444-8444-444444444444";

const RECORD: LeadContactRecord = {
  customerDisplayName: "Ana Cliente",
  email: "ana@example.com",
  phone: "+34600111222",
  addressLine1: "Calle Mayor 1",
  addressLine2: null,
  postalCode: "28013",
  city: "Madrid",
  province: "Madrid",
};

/**
 * A fake authorization reader that behaves like the real adapter: it only ever
 * surfaces the grant of the professional it is asked about, for the lead asked about.
 * `purchases` is a mutable "database" so lifecycle changes are visible immediately.
 */
function world(purchases: Array<{ leadId: string; pro: string; status: LeadPurchaseStatus }>, ownership = true, flow: "LEAD_V1" | "LEGACY_QUOTE_PAYMENT" = "LEAD_V1") {
  const authorization: LeadContactAuthorizationReader = {
    findFacts: vi.fn(async (leadId: string, pro: string) => {
      if (leadId !== LEAD) return null;
      const row = purchases.find((p) => p.leadId === leadId && p.pro === pro && p.status === "CONFIRMED") ?? purchases.find((p) => p.leadId === leadId && p.pro === pro);
      return {
        leadExists: true,
        flowVersion: flow,
        blocked: false,
        contactOwnershipConsistent: ownership,
        grant: row ? { state: toLeadContactGrantState(row.status), professionalProfileId: row.pro } : null,
      } satisfies LeadContactAuthorizationFacts;
    }),
  };
  const contacts: LeadContactReader = { readContact: vi.fn(async () => RECORD) };
  const users = { findById: vi.fn(async (id: string) => ({ id, status: "ACTIVE" })) } as unknown as UserRepository;
  const professionals = {
    findByUserId: vi.fn(async (userId: string) => (userId === USER_A ? { id: PRO_A, status: "ACTIVE" } : userId === USER_B ? { id: PRO_B, status: "ACTIVE" } : null)),
  } as unknown as ProfessionalRepository;
  return { useCase: new GetLeadContactUseCase(users, professionals, authorization, contacts), authorization, contacts };
}

const denied = async (p: Promise<unknown>) => expect(await p.then(() => null, (e: unknown) => e)).toBeInstanceOf(LeadContactAccessDeniedError);

describe("M138 — status authorization matrix", () => {
  it.each(LEAD_PURCHASE_STATUSES)("%s", async (status) => {
    const { useCase, contacts } = world([{ leadId: LEAD, pro: PRO_A, status }]);
    if (status === "CONFIRMED") {
      expect((await useCase.execute(USER_A, LEAD)).email).toBe("ana@example.com");
    } else {
      await denied(useCase.execute(USER_A, LEAD));
      expect(contacts.readContact).not.toHaveBeenCalled();
    }
  });
});

describe("M138 — lifecycle (dynamic, no stale authorization)", () => {
  it("PENDING_PAYMENT -> CONFIRMED -> contact; then REFUNDED / REVOKED -> no contact", async () => {
    for (const end of ["REFUNDED", "REVOKED"] as const) {
      const rows = [{ leadId: LEAD, pro: PRO_A, status: "PENDING_PAYMENT" as LeadPurchaseStatus }];
      const { useCase } = world(rows);
      await denied(useCase.execute(USER_A, LEAD));
      rows[0]!.status = "CONFIRMED";
      await expect(useCase.execute(USER_A, LEAD)).resolves.toMatchObject({ leadId: LEAD });
      rows[0]!.status = end;
      await denied(useCase.execute(USER_A, LEAD));
    }
  });
});

describe("M138 — identity and binding", () => {
  it("professional A cannot use professional B's confirmed purchase", async () => {
    const { useCase } = world([{ leadId: LEAD, pro: PRO_B, status: "CONFIRMED" }]);
    await denied(useCase.execute(USER_A, LEAD));
    await expect(useCase.execute(USER_B, LEAD)).resolves.toMatchObject({ leadId: LEAD });
  });

  it("a confirmed purchase for another lead does not unlock this lead", async () => {
    const { useCase } = world([{ leadId: OTHER_LEAD, pro: PRO_A, status: "CONFIRMED" }]);
    await denied(useCase.execute(USER_A, LEAD));
  });

  it("the use case signature accepts only (userId, leadId): a body-supplied professionalProfileId cannot impersonate", async () => {
    expect(GetLeadContactUseCase.prototype.execute.length).toBe(2);
    const { useCase, authorization } = world([{ leadId: LEAD, pro: PRO_B, status: "CONFIRMED" }]);
    // Extra (attacker-controlled) arguments are ignored: the professional id is resolved from the session user.
    await denied((useCase.execute as (...a: unknown[]) => Promise<unknown>)(USER_A, LEAD, PRO_B));
    expect(authorization.findFacts).toHaveBeenCalledWith(LEAD, PRO_A);
  });

  it("no session identity -> denied, nothing read", async () => {
    const { useCase, authorization } = world([{ leadId: LEAD, pro: PRO_A, status: "CONFIRMED" }]);
    await denied(useCase.execute("", LEAD));
    await denied(useCase.execute(undefined as never, LEAD));
    expect(authorization.findFacts).not.toHaveBeenCalled();
  });

  it("knowing a lead id (no purchase) grants nothing", async () => {
    await denied(world([]).useCase.execute(USER_A, LEAD));
  });

  it("legacy flow cannot unlock LEAD_V1 contact even with a confirmed purchase", async () => {
    await denied(world([{ leadId: LEAD, pro: PRO_A, status: "CONFIRMED" }], true, "LEGACY_QUOTE_PAYMENT").useCase.execute(USER_A, LEAD));
  });

  it("customer ownership mismatch denies even with a confirmed purchase", async () => {
    const { useCase, contacts } = world([{ leadId: LEAD, pro: PRO_A, status: "CONFIRMED" }], false);
    await denied(useCase.execute(USER_A, LEAD));
    expect(contacts.readContact).not.toHaveBeenCalled();
  });

  it("policy: ownership flag must be exactly true (fail closed)", () => {
    const base: LeadContactAuthorizationFacts = {
      leadExists: true,
      flowVersion: "LEAD_V1",
      blocked: false,
      contactOwnershipConsistent: true,
      grant: { state: "CONFIRMED", professionalProfileId: PRO_A },
    };
    expect(canProfessionalAccessLeadContact(base, PRO_A)).toEqual({ allowed: true });
    for (const bad of [false, undefined, null, "true", 1]) {
      expect(canProfessionalAccessLeadContact({ ...base, contactOwnershipConsistent: bad as never }, PRO_A)).toEqual({ allowed: false, reason: "OWNERSHIP_MISMATCH" });
    }
  });
});

describe("M138 — data minimization and no leak through purchase DTOs", () => {
  it("contact DTO exposes exactly the M122 whitelist, nothing financial/internal", () => {
    const dto = toLeadContactDto(LEAD, { ...RECORD, latitude: 1, longitude: 2, userId: "u", price: 9, taxAmount: 2, stripePaymentIntentId: "pi_1" } as never);
    expect(Object.keys(dto).sort()).toEqual(["address", "customerDisplayName", "email", "leadId", "phone"]);
    expect(Object.keys(dto.address).sort()).toEqual(["city", "line1", "line2", "postalCode", "province"]);
    const json = JSON.stringify(dto);
    for (const leaked of ["latitude", "longitude", "userId", "price", "taxAmount", "stripe", "pi_1"]) expect(json).not.toContain(leaked);
  });

  it("purchase DTO (initiation / confirmation / pending / any status) never contains contact data", () => {
    const base = {
      id: "p1", leadId: LEAD, professionalProfileId: PRO_A, price: 10, currency: "EUR", confirmedAt: null, failedAt: null, cancelledAt: null,
      refundedAt: null, revokedAt: null, createdAt: new Date(), updatedAt: new Date(),
      financialSnapshot: { taxAmount: "2.10", totalAmount: "12.10", taxPolicyVersion: "v1" },
      email: RECORD.email, phone: RECORD.phone, addressLine1: RECORD.addressLine1, customerDisplayName: RECORD.customerDisplayName,
    };
    for (const status of LEAD_PURCHASE_STATUSES) {
      const dto = toLeadPurchaseDto({ ...base, status } as never);
      const json = JSON.stringify(dto);
      for (const secret of [RECORD.email, RECORD.phone, RECORD.addressLine1, "Ana Cliente"]) expect(json).not.toContain(secret as string);
      for (const key of ["email", "phone", "addressLine1", "customerDisplayName", "professionalProfileId"]) expect(Object.keys(dto)).not.toContain(key);
    }
  });

  it("denial error carries no ids, contact or purchase info", async () => {
    const { useCase } = world([{ leadId: LEAD, pro: PRO_B, status: "CONFIRMED" }]);
    const e = (await useCase.execute(USER_A, LEAD).catch((x: Error) => x)) as Error;
    const text = `${e.name}${e.message}${JSON.stringify(e)}`;
    for (const secret of [LEAD, PRO_A, PRO_B, "ana@example.com", "CONFIRMED"]) expect(text).not.toContain(secret);
  });
});
