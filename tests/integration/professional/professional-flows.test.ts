import { beforeEach, describe, expect, it } from "vitest";

import { CreateProfessionalUseCase } from "@/application/use-cases/professional/create-professional.use-case";
import { DeactivateProfessionalUseCase } from "@/application/use-cases/professional/deactivate-professional.use-case";
import { GetProfessionalByUserIdUseCase } from "@/application/use-cases/professional/get-professional-by-user-id.use-case";
import { GetProfessionalUseCase } from "@/application/use-cases/professional/get-professional.use-case";
import { UpdateProfessionalServicesUseCase } from "@/application/use-cases/professional/update-professional-services.use-case";
import { UpdateProfessionalUseCase } from "@/application/use-cases/professional/update-professional.use-case";
import { FakeProfessionalRepository, FakeServiceCategoryRepository } from "./fakes";

const PLUMBING_ID = "11111111-1111-1111-1111-111111111111";
const ELECTRICAL_ID = "22222222-2222-2222-2222-222222222222";
const UNKNOWN_CATEGORY_ID = "99999999-9999-9999-9999-999999999999";

describe("CreateProfessionalUseCase", () => {
  let professionals: FakeProfessionalRepository;
  let categories: FakeServiceCategoryRepository;

  beforeEach(() => {
    professionals = new FakeProfessionalRepository();
    categories = new FakeServiceCategoryRepository();
    categories.seed({ id: PLUMBING_ID, name: "Plumbing", slug: "plumbing" });
    categories.seed({ id: ELECTRICAL_ID, name: "Electrical", slug: "electrical" });
  });

  it("creates a professional profile for the authenticated user", async () => {
    const profile = await new CreateProfessionalUseCase(professionals, categories).execute("user-1", {
      businessName: "Ana's Plumbing",
      categoryIds: [PLUMBING_ID],
    });

    expect(profile.userId).toBe("user-1");
    expect(profile.businessName).toBe("Ana's Plumbing");
    expect(profile.status).toBe("ACTIVE");
    expect(profile.verificationStatus).toBe("UNVERIFIED");
    expect(profile.categoryIds).toEqual([PLUMBING_ID]);
  });

  it("rejects creating a second profile for a user who already has one", async () => {
    await new CreateProfessionalUseCase(professionals, categories).execute("user-1", {});

    await expect(
      new CreateProfessionalUseCase(professionals, categories).execute("user-1", {}),
    ).rejects.toThrow();
  });

  it("rejects an unknown/invalid service category id", async () => {
    await expect(
      new CreateProfessionalUseCase(professionals, categories).execute("user-1", {
        categoryIds: [UNKNOWN_CATEGORY_ID],
      }),
    ).rejects.toThrow();
  });
});

describe("GetProfessionalUseCase", () => {
  it("returns a professional profile by its own id", async () => {
    const professionals = new FakeProfessionalRepository();
    const categories = new FakeServiceCategoryRepository();
    const created = await new CreateProfessionalUseCase(professionals, categories).execute(
      "user-1",
      {},
    );

    const found = await new GetProfessionalUseCase(professionals).execute(created.id);
    expect(found.id).toBe(created.id);
  });

  it("throws NotFoundError for an unknown id", async () => {
    const professionals = new FakeProfessionalRepository();
    await expect(new GetProfessionalUseCase(professionals).execute("nope")).rejects.toThrow();
  });
});

describe("GetProfessionalByUserIdUseCase", () => {
  it("returns null when the authenticated user has no professional profile yet", async () => {
    const professionals = new FakeProfessionalRepository();
    const result = await new GetProfessionalByUserIdUseCase(professionals).execute("user-1");
    expect(result).toBeNull();
  });

  it("returns the authenticated user's own profile, never another user's", async () => {
    const professionals = new FakeProfessionalRepository();
    const categories = new FakeServiceCategoryRepository();
    await new CreateProfessionalUseCase(professionals, categories).execute("user-1", {
      businessName: "User One Co",
    });
    await new CreateProfessionalUseCase(professionals, categories).execute("user-2", {
      businessName: "User Two Co",
    });

    const forUserOne = await new GetProfessionalByUserIdUseCase(professionals).execute("user-1");
    const forUserTwo = await new GetProfessionalByUserIdUseCase(professionals).execute("user-2");

    expect(forUserOne?.businessName).toBe("User One Co");
    expect(forUserTwo?.businessName).toBe("User Two Co");
  });
});

describe("UpdateProfessionalUseCase", () => {
  let professionals: FakeProfessionalRepository;
  let categories: FakeServiceCategoryRepository;

  beforeEach(() => {
    professionals = new FakeProfessionalRepository();
    categories = new FakeServiceCategoryRepository();
  });

  it("updates the authenticated user's own profile fields", async () => {
    await new CreateProfessionalUseCase(professionals, categories).execute("user-1", {
      businessName: "Old Name",
    });

    const updated = await new UpdateProfessionalUseCase(professionals).execute("user-1", {
      businessName: "New Name",
    });

    expect(updated.businessName).toBe("New Name");
  });

  it("throws NotFoundError when the user has no professional profile", async () => {
    await expect(
      new UpdateProfessionalUseCase(professionals).execute("user-without-profile", {
        businessName: "Anything",
      }),
    ).rejects.toThrow();
  });

  it("authorization boundary: updating as user-2 never touches user-1's profile", async () => {
    await new CreateProfessionalUseCase(professionals, categories).execute("user-1", {
      businessName: "User One Co",
    });

    // user-2 has no profile of their own — the use case looks the
    // profile up by *their* userId, so this must fail rather than
    // somehow reaching user-1's profile via any other id.
    await expect(
      new UpdateProfessionalUseCase(professionals).execute("user-2", {
        businessName: "Hijacked Name",
      }),
    ).rejects.toThrow();

    const user1Profile = await professionals.findByUserId("user-1");
    expect(user1Profile?.businessName).toBe("User One Co");
  });
});

describe("UpdateProfessionalServicesUseCase", () => {
  let professionals: FakeProfessionalRepository;
  let categories: FakeServiceCategoryRepository;

  beforeEach(() => {
    professionals = new FakeProfessionalRepository();
    categories = new FakeServiceCategoryRepository();
    categories.seed({ id: PLUMBING_ID, name: "Plumbing", slug: "plumbing" });
    categories.seed({ id: ELECTRICAL_ID, name: "Electrical", slug: "electrical" });
  });

  it("replaces the professional's service categories", async () => {
    await new CreateProfessionalUseCase(professionals, categories).execute("user-1", {
      categoryIds: [PLUMBING_ID],
    });

    const updated = await new UpdateProfessionalServicesUseCase(professionals, categories).execute(
      "user-1",
      { categoryIds: [ELECTRICAL_ID] },
    );

    expect(updated.categoryIds).toEqual([ELECTRICAL_ID]);
  });

  it("rejects a category id that doesn't exist or isn't active", async () => {
    await new CreateProfessionalUseCase(professionals, categories).execute("user-1", {});

    await expect(
      new UpdateProfessionalServicesUseCase(professionals, categories).execute("user-1", {
        categoryIds: [UNKNOWN_CATEGORY_ID],
      }),
    ).rejects.toThrow();
  });

  it("throws NotFoundError when the user has no professional profile", async () => {
    await expect(
      new UpdateProfessionalServicesUseCase(professionals, categories).execute("user-1", {
        categoryIds: [PLUMBING_ID],
      }),
    ).rejects.toThrow();
  });
});

describe("DeactivateProfessionalUseCase", () => {
  let professionals: FakeProfessionalRepository;
  let categories: FakeServiceCategoryRepository;

  beforeEach(() => {
    professionals = new FakeProfessionalRepository();
    categories = new FakeServiceCategoryRepository();
  });

  it("deactivates the authenticated user's own profile", async () => {
    await new CreateProfessionalUseCase(professionals, categories).execute("user-1", {});

    await new DeactivateProfessionalUseCase(professionals).execute("user-1");

    const profile = await professionals.findByUserId("user-1");
    expect(profile?.status).toBe("INACTIVE");
  });

  it("rejects deactivating an already-deactivated profile", async () => {
    await new CreateProfessionalUseCase(professionals, categories).execute("user-1", {});
    await new DeactivateProfessionalUseCase(professionals).execute("user-1");

    await expect(new DeactivateProfessionalUseCase(professionals).execute("user-1")).rejects.toThrow();
  });

  it("throws NotFoundError when the user has no professional profile", async () => {
    await expect(
      new DeactivateProfessionalUseCase(professionals).execute("user-without-profile"),
    ).rejects.toThrow();
  });

  it("authorization boundary: deactivating as user-2 never touches user-1's profile", async () => {
    await new CreateProfessionalUseCase(professionals, categories).execute("user-1", {});

    await expect(new DeactivateProfessionalUseCase(professionals).execute("user-2")).rejects.toThrow();

    const user1Profile = await professionals.findByUserId("user-1");
    expect(user1Profile?.status).toBe("ACTIVE");
  });
});
