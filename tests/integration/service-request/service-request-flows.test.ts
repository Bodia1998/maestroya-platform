import { beforeEach, describe, expect, it, vi } from "vitest";

import { AddServiceRequestPhotoUseCase } from "@/application/use-cases/service-request/add-service-request-photo.use-case";
import { CancelServiceRequestUseCase } from "@/application/use-cases/service-request/cancel-service-request.use-case";
import { CreateServiceRequestUseCase } from "@/application/use-cases/service-request/create-service-request.use-case";
import { GetCustomerServiceRequestsUseCase } from "@/application/use-cases/service-request/get-customer-service-requests.use-case";
import { GetServiceRequestUseCase } from "@/application/use-cases/service-request/get-service-request.use-case";
import { RemoveServiceRequestPhotoUseCase } from "@/application/use-cases/service-request/remove-service-request-photo.use-case";
import { UpdateServiceRequestUseCase } from "@/application/use-cases/service-request/update-service-request.use-case";
import {
  FakeCustomerProfileRepository,
  FakeGeocodingProvider,
  FakeRequestPhotoUploadService,
  FakeServiceCategoryRepository,
  FakeServiceRequestRepository,
  VALID_LOCATION,
} from "./fakes";

const PLUMBING_ID = "11111111-1111-1111-1111-111111111111";
const ELECTRICAL_ID = "22222222-2222-2222-2222-222222222222";
const UNKNOWN_CATEGORY_ID = "99999999-9999-9999-9999-999999999999";

function makeRepos() {
  const categories = new FakeServiceCategoryRepository();
  categories.seed({ id: PLUMBING_ID, name: "Plumbing", slug: "plumbing" });
  categories.seed({ id: ELECTRICAL_ID, name: "Electrical", slug: "electrical" });
  const customerProfiles = new FakeCustomerProfileRepository();
  const serviceRequests = new FakeServiceRequestRepository(categories);
  const photoUploadService = new FakeRequestPhotoUploadService();
  return { categories, customerProfiles, serviceRequests, photoUploadService };
}

// Shared across every test below (not per-`makeRepos()` call) purely to
// keep every existing `new CreateServiceRequestUseCase(serviceRequests,
// customerProfiles, categories)` call site a one-line change to
// `createServiceRequestUseCase(...)` with the exact same three positional
// args — no test here asserts on FakeGeocodingProvider's own call log, so a
// single shared instance is sufficient. Defaults to Gandia's real centroid,
// matching `VALID_LOCATION`'s city (see fakes.ts).
const sharedGeocoding = new FakeGeocodingProvider();

function createServiceRequestUseCase(
  serviceRequests: FakeServiceRequestRepository,
  customerProfiles: FakeCustomerProfileRepository,
  categories: FakeServiceCategoryRepository,
) {
  return new CreateServiceRequestUseCase(serviceRequests, customerProfiles, categories, sharedGeocoding);
}

function updateServiceRequestUseCase(
  serviceRequests: FakeServiceRequestRepository,
  customerProfiles: FakeCustomerProfileRepository,
  categories: FakeServiceCategoryRepository,
) {
  return new UpdateServiceRequestUseCase(serviceRequests, customerProfiles, categories, sharedGeocoding);
}

function validInput(overrides: Partial<Parameters<CreateServiceRequestUseCase["execute"]>[1]> = {}) {
  return {
    categoryId: PLUMBING_ID,
    title: "Fix leaking kitchen tap",
    description: "The tap under the kitchen sink has been dripping for a week.",
    location: VALID_LOCATION,
    ...overrides,
  };
}

describe("CreateServiceRequestUseCase", () => {
  it("creates a PUBLISHED request for the authenticated customer", async () => {
    const { serviceRequests, customerProfiles, categories } = makeRepos();

    const request = await createServiceRequestUseCase(serviceRequests, customerProfiles, categories).execute(
      "user-1",
      validInput(),
    );

    expect(request.status).toBe("PUBLISHED");
    expect(request.title).toBe("Fix leaking kitchen tap");
    expect(request.categoryId).toBe(PLUMBING_ID);
    expect(request.location.city).toBe("Gandia");

    const customer = await customerProfiles.findByUserId("user-1");
    expect(request.customerId).toBe(customer?.id);
  });

  it("lazily creates a CustomerProfile for a user who doesn't have one yet", async () => {
    const { serviceRequests, customerProfiles, categories } = makeRepos();

    expect(await customerProfiles.findByUserId("user-1")).toBeNull();
    await createServiceRequestUseCase(serviceRequests, customerProfiles, categories).execute(
      "user-1",
      validInput(),
    );
    expect(await customerProfiles.findByUserId("user-1")).not.toBeNull();
  });

  it("rejects an unknown/invalid/inactive service category id", async () => {
    const { serviceRequests, customerProfiles, categories } = makeRepos();

    await expect(
      createServiceRequestUseCase(serviceRequests, customerProfiles, categories).execute(
        "user-1",
        validInput({ categoryId: UNKNOWN_CATEGORY_ID }),
      ),
    ).rejects.toThrow();
  });

  it("rejects budgetMin greater than budgetMax", async () => {
    const { serviceRequests, customerProfiles, categories } = makeRepos();

    await expect(
      createServiceRequestUseCase(serviceRequests, customerProfiles, categories).execute(
        "user-1",
        validInput({ budgetMin: 200, budgetMax: 100 }),
      ),
    ).rejects.toThrow();
  });

  it("never trusts a client-supplied customerId — ownership always comes from the userId argument", async () => {
    const { serviceRequests, customerProfiles, categories } = makeRepos();

    const request = await createServiceRequestUseCase(serviceRequests, customerProfiles, categories).execute(
      "user-1",
      validInput(),
    );
    const customer1 = await customerProfiles.findByUserId("user-1");
    expect(request.customerId).toBe(customer1?.id);

    // A second user's request is owned by their own (distinct) customer
    // profile, never user-1's, no matter what — there is no input field
    // through which a caller could redirect ownership elsewhere.
    const request2 = await createServiceRequestUseCase(serviceRequests, customerProfiles, categories).execute(
      "user-2",
      validInput(),
    );
    expect(request2.customerId).not.toBe(customer1?.id);
  });

  // Regression test — real bug reported during manual MVP testing: a
  // customer's request never showed up in a same-city, in-radius
  // professional's Available Requests. Root cause: this use case only
  // ever persisted a client-supplied latitude/longitude (which the request
  // form exposes as unlabeled optional fields customers never fill in),
  // so nearly every request was saved with null coordinates — and
  // GetAvailableServiceRequestsForProfessionalUseCase's eligibility rule
  // requires both sides to have coordinates. Fixed by geocoding the
  // entered city (same GeocodingProvider seam CompleteProfessionalOnboardingUseCase
  // already uses for a professional's own base location) whenever the
  // client doesn't supply explicit coordinates.
  it("geocodes the entered city into latitude/longitude when none is supplied (the actual bug fix)", async () => {
    const { serviceRequests, customerProfiles, categories } = makeRepos();
    sharedGeocoding.calls = [];

    const request = await createServiceRequestUseCase(serviceRequests, customerProfiles, categories).execute(
      "user-1",
      validInput(), // VALID_LOCATION has a city but no latitude/longitude
    );

    expect(sharedGeocoding.calls).toEqual([{ city: "Gandia", province: undefined, country: "ES" }]);
    expect(request.location.latitude).toBe(sharedGeocoding.point?.latitude);
    expect(request.location.longitude).toBe(sharedGeocoding.point?.longitude);
  });

  it("never overrides an explicit client-supplied latitude/longitude with a geocoded value", async () => {
    const { serviceRequests, customerProfiles, categories } = makeRepos();

    const request = await createServiceRequestUseCase(serviceRequests, customerProfiles, categories).execute(
      "user-1",
      validInput({ location: { ...VALID_LOCATION, latitude: 1.23, longitude: 4.56 } }),
    );

    expect(request.location.latitude).toBe(1.23);
    expect(request.location.longitude).toBe(4.56);
  });

  it("leaves coordinates null (never throws) when the city is unknown to the geocoding provider", async () => {
    const { serviceRequests, customerProfiles, categories } = makeRepos();
    sharedGeocoding.point = null;

    const request = await createServiceRequestUseCase(serviceRequests, customerProfiles, categories).execute(
      "user-1",
      validInput({ location: { ...VALID_LOCATION, city: "Nowhereville" } }),
    );

    expect(request.status).toBe("PUBLISHED");
    expect(request.location.latitude).toBeNull();
    expect(request.location.longitude).toBeNull();

    sharedGeocoding.point = { latitude: 38.9665, longitude: -0.1817 };
  });
});

describe("Server Action auth boundary (unauthenticated users)", () => {
  // Every Server Action in src/app/(dashboard)/requests/actions.ts
  // (createServiceRequestAction, updateServiceRequestAction, etc.) calls
  // requireAuth() *before* ever touching a use case — an unauthenticated
  // request never reaches CreateServiceRequestUseCase at all. That's the
  // exact same requireAuth() the Professional and Profile modules' actions
  // use (see rbac.ts), verified here rather than duplicating
  // tests/unit/core/infrastructure/auth/rbac.test.ts's coverage of
  // requireAuth's own behavior: this test mocks the same underlying
  // session source (`@/lib/auth`) to confirm the guard this module's
  // actions rely on actually throws for a signed-out caller.
  it("requireAuth throws (and never resolves a userId) when there is no session", async () => {
    vi.doMock("@/lib/auth", () => ({ auth: vi.fn().mockResolvedValue(null) }));
    const { requireAuth } = await import("@/infrastructure/auth/rbac");

    await expect(requireAuth()).rejects.toThrow();

    vi.doUnmock("@/lib/auth");
  });
});

describe("GetServiceRequestUseCase", () => {
  it("returns the owning customer's own request", async () => {
    const { serviceRequests, customerProfiles, categories } = makeRepos();
    const created = await createServiceRequestUseCase(serviceRequests, customerProfiles, categories).execute(
      "user-1",
      validInput(),
    );

    const found = await new GetServiceRequestUseCase(serviceRequests, customerProfiles).execute(
      "user-1",
      created.id,
    );
    expect(found.id).toBe(created.id);
  });

  it("throws NotFoundError for an unknown request id", async () => {
    const { serviceRequests, customerProfiles } = makeRepos();
    await expect(
      new GetServiceRequestUseCase(serviceRequests, customerProfiles).execute("user-1", "nope"),
    ).rejects.toThrow();
  });

  it("never leaks another customer's request — non-owner gets the same not-found error", async () => {
    const { serviceRequests, customerProfiles, categories } = makeRepos();
    const created = await createServiceRequestUseCase(serviceRequests, customerProfiles, categories).execute(
      "user-1",
      validInput(),
    );

    await expect(
      new GetServiceRequestUseCase(serviceRequests, customerProfiles).execute("user-2", created.id),
    ).rejects.toThrow();
  });
});

describe("GetCustomerServiceRequestsUseCase", () => {
  it("lists only the authenticated customer's own requests", async () => {
    const { serviceRequests, customerProfiles, categories } = makeRepos();
    await createServiceRequestUseCase(serviceRequests, customerProfiles, categories).execute(
      "user-1",
      validInput({ title: "User one's request" }),
    );
    await createServiceRequestUseCase(serviceRequests, customerProfiles, categories).execute(
      "user-2",
      validInput({ title: "User two's request" }),
    );

    const forUserOne = await new GetCustomerServiceRequestsUseCase(serviceRequests, customerProfiles).execute(
      "user-1",
    );

    expect(forUserOne).toHaveLength(1);
    expect(forUserOne[0]?.title).toBe("User one's request");
  });

  it("returns an empty list for a user with no CustomerProfile/requests yet", async () => {
    const { serviceRequests, customerProfiles } = makeRepos();
    const result = await new GetCustomerServiceRequestsUseCase(serviceRequests, customerProfiles).execute(
      "user-without-requests",
    );
    expect(result).toEqual([]);
  });
});

describe("UpdateServiceRequestUseCase", () => {
  it("updates the owner's own PUBLISHED (open) request", async () => {
    const { serviceRequests, customerProfiles, categories } = makeRepos();
    const created = await createServiceRequestUseCase(serviceRequests, customerProfiles, categories).execute(
      "user-1",
      validInput(),
    );

    const updated = await updateServiceRequestUseCase(serviceRequests, customerProfiles, categories).execute(
      "user-1",
      created.id,
      { title: "Updated title", categoryId: ELECTRICAL_ID },
    );

    expect(updated.title).toBe("Updated title");
    expect(updated.categoryId).toBe(ELECTRICAL_ID);
  });

  it("rejects a non-owner updating another customer's request", async () => {
    const { serviceRequests, customerProfiles, categories } = makeRepos();
    const created = await createServiceRequestUseCase(serviceRequests, customerProfiles, categories).execute(
      "user-1",
      validInput(),
    );
    // user-2 needs their own CustomerProfile to exist for the "not found"
    // path vs. "no profile at all" path to both be exercised elsewhere;
    // here we simulate an attacker who already has one of their own.
    await customerProfiles.findOrCreateByUserId("user-2");

    await expect(
      updateServiceRequestUseCase(serviceRequests, customerProfiles, categories).execute(
        "user-2",
        created.id,
        { title: "Hijacked title" },
      ),
    ).rejects.toThrow();

    const stillOriginal = await serviceRequests.findById(created.id);
    expect(stillOriginal?.title).not.toBe("Hijacked title");
  });

  it("rejects editing a CANCELLED request", async () => {
    const { serviceRequests, customerProfiles, categories } = makeRepos();
    const created = await createServiceRequestUseCase(serviceRequests, customerProfiles, categories).execute(
      "user-1",
      validInput(),
    );
    await new CancelServiceRequestUseCase(serviceRequests, customerProfiles).execute("user-1", created.id);

    await expect(
      updateServiceRequestUseCase(serviceRequests, customerProfiles, categories).execute(
        "user-1",
        created.id,
        { title: "Should not apply" },
      ),
    ).rejects.toThrow();
  });

  it("rejects an invalid category on update", async () => {
    const { serviceRequests, customerProfiles, categories } = makeRepos();
    const created = await createServiceRequestUseCase(serviceRequests, customerProfiles, categories).execute(
      "user-1",
      validInput(),
    );

    await expect(
      updateServiceRequestUseCase(serviceRequests, customerProfiles, categories).execute(
        "user-1",
        created.id,
        { categoryId: UNKNOWN_CATEGORY_ID },
      ),
    ).rejects.toThrow();
  });
});

describe("CancelServiceRequestUseCase", () => {
  it("cancels the owner's own PUBLISHED request", async () => {
    const { serviceRequests, customerProfiles, categories } = makeRepos();
    const created = await createServiceRequestUseCase(serviceRequests, customerProfiles, categories).execute(
      "user-1",
      validInput(),
    );

    await new CancelServiceRequestUseCase(serviceRequests, customerProfiles).execute("user-1", created.id);

    const cancelled = await serviceRequests.findById(created.id);
    expect(cancelled?.status).toBe("CANCELLED");
  });

  it("rejects cancelling an already-CANCELLED request", async () => {
    const { serviceRequests, customerProfiles, categories } = makeRepos();
    const created = await createServiceRequestUseCase(serviceRequests, customerProfiles, categories).execute(
      "user-1",
      validInput(),
    );
    await new CancelServiceRequestUseCase(serviceRequests, customerProfiles).execute("user-1", created.id);

    await expect(
      new CancelServiceRequestUseCase(serviceRequests, customerProfiles).execute("user-1", created.id),
    ).rejects.toThrow();
  });

  it("rejects a non-owner cancelling another customer's request", async () => {
    const { serviceRequests, customerProfiles, categories } = makeRepos();
    const created = await createServiceRequestUseCase(serviceRequests, customerProfiles, categories).execute(
      "user-1",
      validInput(),
    );
    await customerProfiles.findOrCreateByUserId("user-2");

    await expect(
      new CancelServiceRequestUseCase(serviceRequests, customerProfiles).execute("user-2", created.id),
    ).rejects.toThrow();

    const stillPublished = await serviceRequests.findById(created.id);
    expect(stillPublished?.status).toBe("PUBLISHED");
  });

  it("throws NotFoundError when the requestId doesn't exist", async () => {
    const { serviceRequests, customerProfiles } = makeRepos();
    await customerProfiles.findOrCreateByUserId("user-1");
    await expect(
      new CancelServiceRequestUseCase(serviceRequests, customerProfiles).execute("user-1", "nope"),
    ).rejects.toThrow();
  });
});

describe("AddServiceRequestPhotoUseCase / RemoveServiceRequestPhotoUseCase", () => {
  let serviceRequests: FakeServiceRequestRepository;
  let customerProfiles: FakeCustomerProfileRepository;
  let categories: FakeServiceCategoryRepository;
  let photoUploadService: FakeRequestPhotoUploadService;

  beforeEach(() => {
    ({ serviceRequests, customerProfiles, categories, photoUploadService } = makeRepos());
  });

  it("adds a photo to the owner's own open request", async () => {
    const created = await createServiceRequestUseCase(serviceRequests, customerProfiles, categories).execute(
      "user-1",
      validInput(),
    );

    const photo = await new AddServiceRequestPhotoUseCase(
      serviceRequests,
      customerProfiles,
      photoUploadService,
    ).execute("user-1", created.id, Buffer.from("fake-bytes"), "image/png");

    expect(photo.url).toContain(created.id);
    const updated = await serviceRequests.findById(created.id);
    expect(updated?.photos).toHaveLength(1);
  });

  it("enforces the max photos per request limit", async () => {
    const created = await createServiceRequestUseCase(serviceRequests, customerProfiles, categories).execute(
      "user-1",
      validInput(),
    );
    const useCase = new AddServiceRequestPhotoUseCase(serviceRequests, customerProfiles, photoUploadService);

    for (let i = 0; i < 6; i += 1) {
      await useCase.execute("user-1", created.id, Buffer.from("fake-bytes"), "image/png");
    }

    await expect(
      useCase.execute("user-1", created.id, Buffer.from("fake-bytes"), "image/png"),
    ).rejects.toThrow();
  });

  it("rejects adding a photo to another customer's request", async () => {
    const created = await createServiceRequestUseCase(serviceRequests, customerProfiles, categories).execute(
      "user-1",
      validInput(),
    );
    await customerProfiles.findOrCreateByUserId("user-2");

    await expect(
      new AddServiceRequestPhotoUseCase(serviceRequests, customerProfiles, photoUploadService).execute(
        "user-2",
        created.id,
        Buffer.from("fake-bytes"),
        "image/png",
      ),
    ).rejects.toThrow();
  });

  it("rejects adding a photo to a CANCELLED request", async () => {
    const created = await createServiceRequestUseCase(serviceRequests, customerProfiles, categories).execute(
      "user-1",
      validInput(),
    );
    await new CancelServiceRequestUseCase(serviceRequests, customerProfiles).execute("user-1", created.id);

    await expect(
      new AddServiceRequestPhotoUseCase(serviceRequests, customerProfiles, photoUploadService).execute(
        "user-1",
        created.id,
        Buffer.from("fake-bytes"),
        "image/png",
      ),
    ).rejects.toThrow();
  });

  it("removes a photo from the owner's own open request", async () => {
    const created = await createServiceRequestUseCase(serviceRequests, customerProfiles, categories).execute(
      "user-1",
      validInput(),
    );
    const photo = await new AddServiceRequestPhotoUseCase(
      serviceRequests,
      customerProfiles,
      photoUploadService,
    ).execute("user-1", created.id, Buffer.from("fake-bytes"), "image/png");

    await new RemoveServiceRequestPhotoUseCase(serviceRequests, customerProfiles).execute(
      "user-1",
      created.id,
      photo.id,
    );

    const updated = await serviceRequests.findById(created.id);
    expect(updated?.photos).toHaveLength(0);
  });

  it("rejects removing a photo from another customer's request", async () => {
    const created = await createServiceRequestUseCase(serviceRequests, customerProfiles, categories).execute(
      "user-1",
      validInput(),
    );
    const photo = await new AddServiceRequestPhotoUseCase(
      serviceRequests,
      customerProfiles,
      photoUploadService,
    ).execute("user-1", created.id, Buffer.from("fake-bytes"), "image/png");
    await customerProfiles.findOrCreateByUserId("user-2");

    await expect(
      new RemoveServiceRequestPhotoUseCase(serviceRequests, customerProfiles).execute(
        "user-2",
        created.id,
        photo.id,
      ),
    ).rejects.toThrow();
  });
});
