import { describe, expect, it } from "vitest";

import { UpdateProfessionalUseCase } from "@/application/use-cases/professional/update-professional.use-case";
import { CreateProfessionalUseCase } from "@/application/use-cases/professional/create-professional.use-case";
import { FakeProfessionalRepository, FakeServiceCategoryRepository } from "../professional/fakes";

/**
 * Professional Discovery & Search module requirement #6 ("a professional
 * must be able to configure their own service radius") is already fully
 * covered by the existing Professional Module's UpdateProfessionalUseCase
 * and its `serviceRadiusKm` field — see update-professional.use-case.ts
 * and professional.dto.ts. These tests exercise that existing use case
 * specifically for the service-radius scenarios this module's spec calls
 * out, rather than introducing a duplicate use case.
 */
describe("Service radius management (via the existing UpdateProfessionalUseCase)", () => {
  it("lets a professional update their own service radius", async () => {
    const professionals = new FakeProfessionalRepository();
    const categories = new FakeServiceCategoryRepository();

    await new CreateProfessionalUseCase(professionals, categories).execute("user-1", {
      serviceRadiusKm: 10,
    });

    const updated = await new UpdateProfessionalUseCase(professionals).execute("user-1", {
      serviceRadiusKm: 25,
    });

    expect(updated.serviceRadiusKm).toBe(25);
  });

  it("never lets a professional update another professional's service radius", async () => {
    const professionals = new FakeProfessionalRepository();
    const categories = new FakeServiceCategoryRepository();

    await new CreateProfessionalUseCase(professionals, categories).execute("user-1", {
      serviceRadiusKm: 10,
    });
    await new CreateProfessionalUseCase(professionals, categories).execute("user-2", {
      serviceRadiusKm: 20,
    });

    // user-2 attempts to change their own radius — this must never be able
    // to reach user-1's profile no matter what. The use case resolves the
    // profile to update strictly via the authenticated userId, never a
    // client-supplied professionalId, so there is no code path by which
    // user-2 could target user-1's profile at all.
    await new UpdateProfessionalUseCase(professionals).execute("user-2", { serviceRadiusKm: 99 });

    const user1Profile = await professionals.findByUserId("user-1");
    expect(user1Profile?.serviceRadiusKm).toBe(10);
  });

  it("throws when the authenticated user has no professional profile to update", async () => {
    const professionals = new FakeProfessionalRepository();

    await expect(
      new UpdateProfessionalUseCase(professionals).execute("user-without-profile", {
        serviceRadiusKm: 15,
      }),
    ).rejects.toThrow();
  });
});
