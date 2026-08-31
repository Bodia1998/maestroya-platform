import { beforeEach, describe, expect, it } from "vitest";

import type { AddressRepository, UpsertAddressData } from "@/domain/repositories/address-repository";
import type { CityGeocodeQuery, GeocodingProvider } from "@/domain/repositories/geocoding-provider";
import type { CreateProfessionalData, ProfessionalRecord } from "@/domain/repositories/professional-repository";
import { CompleteProfessionalOnboardingUseCase } from "@/application/use-cases/professional/complete-professional-onboarding.use-case";
import { CreateProfessionalUseCase } from "@/application/use-cases/professional/create-professional.use-case";
import { FakeUserRepository } from "../auth/fakes";
import { FakeAddressRepository } from "../profile/fakes";
import { FakeProfessionalRepository, FakeServiceCategoryRepository } from "./fakes";

const PLUMBING_ID = "11111111-1111-1111-1111-111111111111";
const UNKNOWN_CATEGORY_ID = "99999999-9999-9999-9999-999999999999";

/**
 * Mirrors exactly what `PrismaProfessionalRepository.create` really does in
 * production (see its own doc comment: creating the profile and granting
 * the PROVIDER role happen atomically, in one transaction) — the plain
 * `FakeProfessionalRepository` used by professional-flows.test.ts
 * deliberately does *not* model that cross-repository side effect (role
 * assignment is infrastructure-only behavior, out of scope for testing
 * `CreateProfessionalUseCase` in isolation). `CompleteProfessionalOnboardingUseCase`
 * exists specifically to end with "PROVIDER granted", so this wrapper
 * reproduces that one behavior for these tests without touching the
 * shared fake other suites rely on.
 */
class FakeProfessionalRepositoryWithRoleGrant extends FakeProfessionalRepository {
  constructor(private readonly users: FakeUserRepository) {
    super();
  }

  override async create(userId: string, data: CreateProfessionalData): Promise<ProfessionalRecord> {
    const record = await super.create(userId, data);
    await this.users.assignDefaultRole(userId, "PROVIDER");
    return record;
  }
}

class FakeGeocodingProvider implements GeocodingProvider {
  calls: CityGeocodeQuery[] = [];
  point: { latitude: number; longitude: number } | null = { latitude: 38.9665, longitude: -0.1817 };

  async geocode(query: CityGeocodeQuery) {
    this.calls.push(query);
    return this.point;
  }
}

class FailingAddressRepository implements AddressRepository {
  async findPrimaryByUserId() {
    return null;
  }
  async upsertPrimaryForUser(_userId: string, _data: UpsertAddressData): Promise<never> {
    throw new Error("address database unavailable");
  }

  // --- Module 88: GDPR Erasure Execution (test stub) ---
  async eraseForUser(_userId: string) {}
}

const validInput = {
  categoryIds: [PLUMBING_ID],
  contactPhone: "+34600000000",
  bio: "10 years fixing pipes across the Valencia region.",
  serviceRadiusKm: 20,
  address: {
    line1: "Carrer Major 12",
    line2: undefined,
    city: "Gandia",
    province: "Valencia",
    postalCode: "46700",
    country: "ES",
  },
};

describe("CompleteProfessionalOnboardingUseCase", () => {
  let users: FakeUserRepository;
  let addresses: FakeAddressRepository;
  let geocoding: FakeGeocodingProvider;
  let professionals: FakeProfessionalRepositoryWithRoleGrant;
  let categories: FakeServiceCategoryRepository;

  beforeEach(async () => {
    users = new FakeUserRepository();
    addresses = new FakeAddressRepository();
    geocoding = new FakeGeocodingProvider();
    professionals = new FakeProfessionalRepositoryWithRoleGrant(users);
    categories = new FakeServiceCategoryRepository();
    categories.seed({ id: PLUMBING_ID, name: "Plumbing", slug: "plumbing" });

    await users.createWithPassword({
      email: "ana@example.com",
      name: "Ana",
      passwordHash: "hash",
      signupIntent: "PROFESSIONAL",
    });
  });

  function makeUseCase() {
    const createProfessional = new CreateProfessionalUseCase(professionals, categories);
    return new CompleteProfessionalOnboardingUseCase(users, addresses, geocoding, createProfessional);
  }

  it("geocodes the base location, saves the address, creates the profile, grants PROVIDER, and clears signupIntent", async () => {
    const [userId] = [...users.users.keys()];

    const professional = await makeUseCase().execute(userId!, validInput);

    // Professional profile creation
    expect(professional.contactPhone).toBe("+34600000000");
    expect(professional.bio).toBe(validInput.bio);
    expect(professional.serviceRadiusKm).toBe(20);
    expect(professional.categoryIds).toEqual([PLUMBING_ID]);
    expect(professional.status).toBe("ACTIVE");

    // Address creation, including the resolved coordinates
    expect(geocoding.calls).toEqual([{ city: "Gandia", province: "Valencia" }]);
    const savedAddress = await addresses.findPrimaryByUserId(userId!);
    expect(savedAddress).toMatchObject({
      city: "Gandia",
      postalCode: "46700",
      latitude: 38.9665,
      longitude: -0.1817,
    });

    // PROVIDER role activation
    expect(await users.getRoleKeys(userId!)).toContain("PROVIDER");

    // signupIntent cleared
    expect(await users.getSignupIntent(userId!)).toBeNull();
  });

  it("still completes onboarding when the geocoding provider doesn't recognize the city (coordinates left null)", async () => {
    const [userId] = [...users.users.keys()];
    geocoding.point = null;

    const professional = await makeUseCase().execute(userId!, validInput);

    expect(professional.status).toBe("ACTIVE");
    const savedAddress = await addresses.findPrimaryByUserId(userId!);
    expect(savedAddress?.latitude).toBeNull();
    expect(savedAddress?.longitude).toBeNull();

    // Onboarding still completes fully — a geocoding miss degrades
    // gracefully, it never blocks account setup.
    expect(await users.getRoleKeys(userId!)).toContain("PROVIDER");
    expect(await users.getSignupIntent(userId!)).toBeNull();
  });

  it("propagates a category validation failure without granting PROVIDER or clearing signupIntent", async () => {
    const [userId] = [...users.users.keys()];

    await expect(
      makeUseCase().execute(userId!, { ...validInput, categoryIds: [UNKNOWN_CATEGORY_ID] }),
    ).rejects.toThrow();

    expect(await users.getRoleKeys(userId!)).not.toContain("PROVIDER");
    expect(await users.getSignupIntent(userId!)).toBe("PROFESSIONAL");

    // The address entry is not lost even though profile creation failed
    // afterwards — see CompleteProfessionalOnboardingUseCase's own doc
    // comment on ordering.
    const savedAddress = await addresses.findPrimaryByUserId(userId!);
    expect(savedAddress?.city).toBe("Gandia");
  });

  it("rejects onboarding a second time for a user who already completed it", async () => {
    const [userId] = [...users.users.keys()];
    await makeUseCase().execute(userId!, validInput);

    await expect(makeUseCase().execute(userId!, validInput)).rejects.toThrow();
  });

  it("propagates an address repository failure without creating the profile or granting PROVIDER", async () => {
    const [userId] = [...users.users.keys()];
    const createProfessional = new CreateProfessionalUseCase(professionals, categories);
    const useCase = new CompleteProfessionalOnboardingUseCase(
      users,
      new FailingAddressRepository(),
      geocoding,
      createProfessional,
    );

    await expect(useCase.execute(userId!, validInput)).rejects.toThrow(
      "address database unavailable",
    );

    expect(await professionals.findByUserId(userId!)).toBeNull();
    expect(await users.getRoleKeys(userId!)).not.toContain("PROVIDER");
    expect(await users.getSignupIntent(userId!)).toBe("PROFESSIONAL");
  });
});
