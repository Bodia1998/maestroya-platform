import { describe, expect, it, vi } from "vitest";

import {
  PRIVATE_CONTACT_FIELD_NAMES,
  toLeadContactDto,
  toLeadPreviewDto,
} from "@/application/dto/lead-contact.dto";
import type { LeadContactAuthorizationReader, LeadContactReader, LeadContactRecord } from "@/application/ports/lead-contact-access";
import { GetLeadContactUseCase } from "@/application/use-cases/lead-contact/get-lead-contact.use-case";
import {
  LeadContactAccessDeniedError,
  canProfessionalAccessLeadContact,
  type LeadContactAuthorizationFacts,
} from "@/domain/services/lead-contact-access-policy";
import type { ProfessionalRepository } from "@/domain/repositories/professional-repository";
import type { UserRepository } from "@/domain/repositories/user-repository";

vi.mock("@/infrastructure/observability/logger", () => ({
  logger: { warn: vi.fn(), info: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

const LEAD = "11111111-1111-4111-8111-111111111111";
const PRO_USER = "22222222-2222-4222-8222-222222222222";
const PRO_ID = "33333333-3333-4333-8333-333333333333";
const OTHER_PRO_ID = "44444444-4444-4444-8444-444444444444";
const CUSTOMER_USER = "55555555-5555-4555-8555-555555555555";

const SECRET_EMAIL = "secret.customer@example.com";
const SECRET_PHONE = "+34600111222";

const RECORD: LeadContactRecord = {
  customerDisplayName: "Ana Cliente",
  email: SECRET_EMAIL,
  phone: SECRET_PHONE,
  addressLine1: "Calle Mayor 1",
  addressLine2: "2B",
  postalCode: "28013",
  city: "Madrid",
  province: "Madrid",
};

function facts(overrides: Partial<LeadContactAuthorizationFacts> = {}): LeadContactAuthorizationFacts {
  return {
    leadExists: true,
    flowVersion: "LEAD_V1",
    grant: { state: "CONFIRMED", professionalProfileId: PRO_ID },
    blocked: false,
    ...overrides,
  };
}

function build(opts: {
  userStatus?: string | null;
  professional?: "ACTIVE" | "SUSPENDED" | null;
  facts?: LeadContactAuthorizationFacts | null;
} = {}) {
  const calls: string[] = [];
  const users = {
    findById: vi.fn(async (id: string) => {
      calls.push("user");
      const status = opts.userStatus === undefined ? "ACTIVE" : opts.userStatus;
      return status === null ? null : ({ id, status } as never);
    }),
  } as unknown as UserRepository;
  const professionals = {
    findByUserId: vi.fn(async (userId: string) => {
      calls.push("professional");
      const p = opts.professional === undefined ? "ACTIVE" : opts.professional;
      return userId === PRO_USER && p ? ({ id: PRO_ID, userId, status: p } as never) : null;
    }),
  } as unknown as ProfessionalRepository;
  const authorization: LeadContactAuthorizationReader = {
    findFacts: vi.fn(async () => {
      calls.push("facts");
      return opts.facts === undefined ? facts() : opts.facts;
    }),
  };
  const contacts: LeadContactReader = {
    readContact: vi.fn(async () => {
      calls.push("contact");
      return RECORD;
    }),
  };
  const useCase = new GetLeadContactUseCase(users, professionals, authorization, contacts);
  return { useCase, contacts, authorization, calls };
}

async function expectDenied(promise: Promise<unknown>) {
  const error = await promise.then(
    () => null,
    (e: unknown) => e,
  );
  expect(error).toBeInstanceOf(LeadContactAccessDeniedError);
  const serialized = JSON.stringify({ message: (error as Error).message, code: (error as LeadContactAccessDeniedError).code });
  expect(serialized).not.toContain(SECRET_EMAIL);
  expect(serialized).not.toContain(SECRET_PHONE);
  expect(serialized).not.toContain(LEAD);
}

describe("GetLeadContactUseCase — authorized access", () => {
  it("returns contact for a professional with a confirmed grant of their own", async () => {
    const { useCase } = build();
    const dto = await useCase.execute(PRO_USER, LEAD);
    expect(dto).toEqual({
      leadId: LEAD,
      customerDisplayName: "Ana Cliente",
      email: SECRET_EMAIL,
      phone: SECRET_PHONE,
      address: { line1: "Calle Mayor 1", line2: "2B", postalCode: "28013", city: "Madrid", province: "Madrid" },
    });
  });

  it("DTO contains only whitelisted keys even if the record carries extra fields", () => {
    const polluted = { ...RECORD, passwordHash: "x", taxId: "y", userId: "z", latitude: 1, longitude: 2 };
    const dto = toLeadContactDto(LEAD, polluted);
    expect(Object.keys(dto).sort()).toEqual(["address", "customerDisplayName", "email", "leadId", "phone"]);
    expect(Object.keys(dto.address).sort()).toEqual(["city", "line1", "line2", "postalCode", "province"]);
    const json = JSON.stringify(dto);
    for (const leaked of ["passwordHash", "taxId", "latitude", "longitude", "userId"]) expect(json).not.toContain(leaked);
  });
});

describe("GetLeadContactUseCase — deny by default", () => {
  it("denies an unauthenticated caller (empty user id)", async () => {
    const { useCase, contacts } = build();
    await expectDenied(useCase.execute("", LEAD));
    expect(contacts.readContact).not.toHaveBeenCalled();
  });

  it("denies a customer with no professional profile", async () => {
    const { useCase, contacts, authorization } = build();
    await expectDenied(useCase.execute(CUSTOMER_USER, LEAD));
    expect(authorization.findFacts).not.toHaveBeenCalled();
    expect(contacts.readContact).not.toHaveBeenCalled();
  });

  it("denies a non-active user and a non-active professional", async () => {
    await expectDenied(build({ userStatus: "SUSPENDED" }).useCase.execute(PRO_USER, LEAD));
    await expectDenied(build({ userStatus: null }).useCase.execute(PRO_USER, LEAD));
    await expectDenied(build({ professional: "SUSPENDED" }).useCase.execute(PRO_USER, LEAD));
  });

  it.each([
    ["malformed lead id", "not-a-uuid"],
    ["empty lead id", ""],
    ["injection-looking lead id", "' OR 1=1 --"],
  ])("denies %s without any lookup", async (_n, leadId) => {
    const { useCase, calls } = build();
    await expectDenied(useCase.execute(PRO_USER, leadId));
    expect(calls).toEqual([]);
  });

  it("denies when the lead does not exist (same error as no grant)", async () => {
    await expectDenied(build({ facts: null }).useCase.execute(PRO_USER, LEAD));
    await expectDenied(build({ facts: facts({ leadExists: false }) }).useCase.execute(PRO_USER, LEAD));
  });

  it("denies a professional without any authorization", async () => {
    await expectDenied(build({ facts: facts({ grant: null }) }).useCase.execute(PRO_USER, LEAD));
  });

  it.each(["PENDING", "REVOKED", "INVALID"] as const)("denies a %s authorization", async (state) => {
    const { useCase, contacts } = build({ facts: facts({ grant: { state, professionalProfileId: PRO_ID } }) });
    await expectDenied(useCase.execute(PRO_USER, LEAD));
    expect(contacts.readContact).not.toHaveBeenCalled();
  });

  it("denies an unrecognised grant state (fails closed)", async () => {
    const odd = facts({ grant: { state: "REFUNDED" as never, professionalProfileId: PRO_ID } });
    await expectDenied(build({ facts: odd }).useCase.execute(PRO_USER, LEAD));
  });

  it("denies another professional's confirmed authorization", async () => {
    const { useCase, contacts } = build({
      facts: facts({ grant: { state: "CONFIRMED", professionalProfileId: OTHER_PRO_ID } }),
    });
    await expectDenied(useCase.execute(PRO_USER, LEAD));
    expect(contacts.readContact).not.toHaveBeenCalled();
  });

  it("denies the wrong flow version (LEGACY_QUOTE_PAYMENT)", async () => {
    await expectDenied(build({ facts: facts({ flowVersion: "LEGACY_QUOTE_PAYMENT" }) }).useCase.execute(PRO_USER, LEAD));
  });

  it("denies when otherwise blocked", async () => {
    await expectDenied(build({ facts: facts({ blocked: true }) }).useCase.execute(PRO_USER, LEAD));
    await expectDenied(build({ facts: facts({ blocked: undefined as never }) }).useCase.execute(PRO_USER, LEAD));
  });

  it("denies when the contact row vanished after authorization", async () => {
    const { useCase, contacts } = build();
    vi.mocked(contacts.readContact).mockResolvedValueOnce(null);
    await expectDenied(useCase.execute(PRO_USER, LEAD));
  });
});

describe("security boundary — contact is never loaded before authorization", () => {
  it("reads contact strictly after a positive decision, and never on denial", async () => {
    const ok = build();
    await ok.useCase.execute(PRO_USER, LEAD);
    expect(ok.calls).toEqual(["user", "professional", "facts", "contact"]);

    const denied = build({ facts: facts({ grant: { state: "PENDING", professionalProfileId: PRO_ID } }) });
    await expectDenied(denied.useCase.execute(PRO_USER, LEAD));
    expect(denied.calls).toEqual(["user", "professional", "facts"]);
  });

  it("denial reasons are identical to the caller", async () => {
    const messages = new Set<string>();
    for (const f of [null, facts({ grant: null }), facts({ flowVersion: "LEGACY_QUOTE_PAYMENT" }), facts({ blocked: true })]) {
      const e = await build({ facts: f }).useCase.execute(PRO_USER, LEAD).catch((x: Error) => x);
      messages.add(`${(e as Error).name}|${(e as Error).message}`);
    }
    expect(messages.size).toBe(1);
  });
});

describe("canProfessionalAccessLeadContact (pure policy)", () => {
  it("allows only the fully valid combination", () => {
    expect(canProfessionalAccessLeadContact(facts(), PRO_ID)).toEqual({ allowed: true });
    expect(canProfessionalAccessLeadContact(null, PRO_ID).allowed).toBe(false);
  });
});

describe("LeadPreviewDTO — leakage", () => {
  const source = {
    leadId: LEAD,
    title: "Fuga de agua",
    description: "Grifo roto",
    categoryId: "c1",
    categoryName: "Fontanería",
    urgency: "HIGH" as const,
    city: "Madrid",
    province: "Madrid",
    distanceKm: 3.2,
    createdAt: new Date("2026-10-01T00:00:00Z"),
  };

  function keysDeep(value: unknown, out: string[] = []): string[] {
    if (Array.isArray(value)) value.forEach((v) => keysDeep(v, out));
    else if (value && typeof value === "object" && !(value instanceof Date)) {
      for (const [k, v] of Object.entries(value)) {
        out.push(k);
        keysDeep(v, out);
      }
    }
    return out;
  }

  it("never contains a private contact field name at any depth", () => {
    const keys = keysDeep(toLeadPreviewDto(source));
    for (const forbidden of PRIVATE_CONTACT_FIELD_NAMES) expect(keys).not.toContain(forbidden);
  });

  it("strips over-fetched nested customer data (Prisma include/select mistakes)", () => {
    const overFetched = {
      ...source,
      customer: { userId: CUSTOMER_USER, user: { email: SECRET_EMAIL, phone: SECRET_PHONE } },
      address: { line1: "Calle Mayor 1", latitude: 40.4, longitude: -3.7 },
      customerUserId: CUSTOMER_USER,
    };
    const dto = toLeadPreviewDto(overFetched);
    const json = JSON.stringify(dto);
    for (const secret of [SECRET_EMAIL, SECRET_PHONE, CUSTOMER_USER, "Calle Mayor", "40.4", "customer"]) {
      expect(json).not.toContain(secret);
    }
    expect(Object.keys(dto).sort()).toEqual(
      ["categoryId", "categoryName", "city", "createdAt", "description", "distanceKm", "leadId", "province", "title", "urgency"],
    );
  });
});
